"""On-the-fly science for a finished or running job: spectra and motion."""
import random

import numpy as np

from .coords import mjd_to_year, propagate
from .framestore import Frame
from .jobs import Job
from .motion import centroid, find_control_stars, fit_proper_motion
from .processing import aperture_flux, wavelength_on_plate

CENTROID_RADIUS_PX = 6
CROP_HALF_WIDTH_PX = 24
BOOTSTRAP_ROUNDS = 16
MIN_SIGMA_ARCSEC = 0.05
FALLBACK_SIGMA_ARCSEC = 1.0
MAX_CONTROL_STARS = 4


def spectrum(job: Job, ra: float, dec: float, pmra: float, pmdec: float, epoch: float) -> list[dict]:
    """Photometry of one sky position in every exposure, ordered by wavelength."""
    points = []
    for frame in job.frames_from(0):
        mjd = frame.meta["mjd"]
        x, y = job.grid.wcs.all_world2pix(*propagate(ra, dec, pmra, pmdec, epoch, mjd), 0)
        measured = aperture_flux(frame.pixels, frame.mask, job.grid, float(x), float(y))
        if measured is None:
            continue
        flux, error, flagged = measured
        points.append(
            {
                "wavelength": round(wavelength_on_plate(frame.meta, job.grid, float(x), float(y)), 4),
                "flux": round(flux, 2),
                "error": round(error, 2),
                "flagged": flagged,
                "detector": frame.meta["detector"],
                "mjd": round(mjd, 3),
                "visit": frame.meta["visit"],
            }
        )
    return sorted(points, key=lambda point: point["wavelength"])


def measure_motion(
    job: Job,
    ra: float,
    dec: float,
    pmra: float,
    pmdec: float,
    epoch: float,
    detectors: set[int],
) -> dict:
    """Track a source between visits and check the method on nearby field stars."""
    frames = [item for item in job.frames_from(0) if item.meta["detector"] in detectors]
    by_visit = _group_by_visit(frames)
    if len(by_visit) < 2:
        raise ValueError("Motion needs frames from at least two dates in these bands")
    scale = job.grid.scale * 3600
    tracked = _track(job, by_visit, ra, dec, pmra, pmdec, epoch, scale)
    if len(tracked) < 2:
        raise ValueError("The source could not be located on at least two dates")
    fit = _fit(tracked)
    controls = _measure_controls(job, frames, by_visit, ra, dec, pmra, pmdec, epoch, scale)
    control_totals = [item["total"] for item in controls]
    catalog = float(np.hypot(pmra, pmdec) / 1000)
    return {
        "visits": tracked,
        "fit": fit,
        "catalog": catalog if catalog > 0 else None,
        "controls": controls,
        "controlMedian": float(np.median(control_totals)) if control_totals else None,
        "detectors": sorted(detectors),
    }


def _group_by_visit(frames: list[Frame]) -> dict[int, list[Frame]]:
    grouped: dict[int, list[Frame]] = {}
    for frame in frames:
        grouped.setdefault(frame.meta["visit"], []).append(frame)
    return dict(sorted(grouped.items()))


def _track(job, by_visit, ra, dec, pmra, pmdec, epoch, scale) -> list[dict]:
    results = []
    x_start = y_start = None
    guess = None
    moving = pmra != 0 or pmdec != 0
    for visit, frames in by_visit.items():
        mjd = float(np.mean([item.meta["mjd"] for item in frames]))
        if moving or guess is None:
            here_ra, here_dec = propagate(ra, dec, pmra, pmdec, epoch, mjd)
            x, y = job.grid.wcs.all_world2pix(here_ra, here_dec, 0)
            guess = (float(x), float(y))
        located = _locate(frames, guess)
        if located is None:
            continue
        (x, y), sigma_px = located
        if x_start is None:
            x_start, y_start = x, y
        guess = (x, y)
        results.append(
            {
                "visit": visit,
                "year": mjd_to_year(mjd),
                "x": x,
                "y": y,
                "east": -(x - x_start) * scale,
                "north": (y - y_start) * scale,
                "sigma": max(sigma_px * scale, MIN_SIGMA_ARCSEC),
                "frames": len(frames),
            }
        )
    return results


def _locate(frames: list[Frame], guess: tuple[float, float]):
    """Centroid of a median stack, with an error from resampling the frames."""
    left = max(int(guess[0]) - CROP_HALF_WIDTH_PX, 0)
    bottom = max(int(guess[1]) - CROP_HALF_WIDTH_PX, 0)
    crops = np.array(
        [
            item.pixels[
                bottom : int(guess[1]) + CROP_HALF_WIDTH_PX,
                left : int(guess[0]) + CROP_HALF_WIDTH_PX,
            ]
            for item in frames
        ]
    )
    start = (guess[0] - left, guess[1] - bottom)
    found = centroid(_median(crops), *start, CENTROID_RADIUS_PX)
    if found is None:
        return None
    resampler = random.Random(len(frames))
    draws = []
    for _ in range(BOOTSTRAP_ROUNDS):
        picks = resampler.choices(range(len(frames)), k=len(frames))
        draw = centroid(_median(crops[picks]), *start, CENTROID_RADIUS_PX)
        if draw is not None:
            draws.append(draw)
    sigma_px = (
        float(np.hypot(*np.std(np.array(draws), axis=0)))
        if len(frames) > 1 and len(draws) > 1
        else FALLBACK_SIGMA_ARCSEC
    )
    return (found[0] + left, found[1] + bottom), sigma_px


def _median(cube: np.ndarray) -> np.ndarray:
    """Per-pixel median that tolerates pixels with no data in any frame."""
    filled = np.where(np.isfinite(cube), cube, np.nan)
    valid = np.isfinite(filled).any(axis=0)
    result = np.full(filled.shape[1:], np.nan, dtype=np.float32)
    result[valid] = np.nanmedian(filled[:, valid], axis=0)
    return result


def _fit(tracked: list[dict]) -> dict:
    fit = fit_proper_motion(
        np.array([item["year"] for item in tracked]),
        np.array([item["east"] for item in tracked]),
        np.array([item["north"] for item in tracked]),
        np.array([item["sigma"] for item in tracked]),
    )
    return {
        "pmEast": fit.pm_east,
        "pmNorth": fit.pm_north,
        "errEast": fit.err_east,
        "errNorth": fit.err_north,
        "total": fit.total,
        "totalErr": fit.total_err,
    }


def _measure_controls(job, frames, by_visit, ra, dec, pmra, pmdec, epoch, scale) -> list[dict]:
    target_mjd = float(np.mean([item.meta["mjd"] for item in frames]))
    target = job.grid.wcs.all_world2pix(*propagate(ra, dec, pmra, pmdec, epoch, target_mjd), 0)
    deep = _median(np.array([item.pixels for item in frames]))
    controls = []
    for x, y in find_control_stars(deep, (float(target[0]), float(target[1])), MAX_CONTROL_STARS):
        star_ra, star_dec = job.grid.wcs.all_pix2world(x, y, 0)
        tracked = _track(job, by_visit, float(star_ra), float(star_dec), 0, 0, epoch, scale)
        if len(tracked) >= 2:
            controls.append({"x": x, "y": y, **_fit(tracked)})
    return controls
