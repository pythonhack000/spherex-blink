"""Packs baked frames into static files, so the challenge targets need no server.

Usage: python -m scripts.build_site [output-directory]
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from backend import gaia, wise
from backend.jobs import Job
from backend.presets import PRESETS

OUTPUT = Path(sys.argv[1] if len(sys.argv) > 1 else "static/data")
NAN_CODE = -32768
ENCODE_STEP = 1e-3  # asinh units per integer step: about 0.1% relative precision
THUMB_SIZE = 480
THUMB_QUALITY = 82
BLOOM_RADIUS = 7
BLOOM_STRENGTH = 0.7
LOW_PERCENTILE, HIGH_PERCENTILE = 25, 99.8
ASINH_SOFTENING = 12
FAST_MOVER_MAS = 1000
MOVER_TINT = (255, 120, 80)
VARIABLE_TINT = (90, 190, 255)
HOT_KNEE = 0.62
SOFT_SCALE_FLOOR = 1e-3


def encode(pixels: np.ndarray, soft_scale: float) -> bytes:
    """Compact pixels to int16 with an asinh curve: faint noise and bright stars both survive."""
    scaled = np.arcsinh(np.nan_to_num(pixels) / soft_scale) / ENCODE_STEP
    codes = np.clip(np.round(scaled), -32767, 32767).astype("<i2")
    return np.where(np.isfinite(pixels), codes, NAN_CODE).astype("<i2").tobytes()


def soft_scale_of(pixels: np.ndarray) -> float:
    finite = pixels[np.isfinite(pixels)]
    spread = float(np.median(np.abs(finite - np.median(finite)))) if finite.size else 0.0
    return max(spread, SOFT_SCALE_FLOOR)


def median_stack(frames) -> np.ndarray:
    return np.nanmedian(np.stack([frame.pixels for frame in frames]), axis=0)


def hot_image(image: np.ndarray, tint, limits) -> Image.Image:
    """Black through the tint to a white-hot core, with bloom, north at the top."""
    low, high = limits
    unit = np.clip((np.nan_to_num(image, nan=low) - low) / (high - low), 0, None)
    level = np.minimum(1, np.arcsinh(unit * ASINH_SOFTENING) / math.asinh(ASINH_SOFTENING))
    rise = np.minimum(level / HOT_KNEE, 1)[..., None] * np.array(tint)
    burn = np.clip((level - HOT_KNEE) / (1 - HOT_KNEE), 0, 1)[..., None]
    rgb = (rise + (255 - rise) * burn).astype(np.uint8)[::-1]
    picture = Image.fromarray(rgb).resize((THUMB_SIZE, THUMB_SIZE), Image.BICUBIC)
    glow = np.asarray(picture.filter(ImageFilter.GaussianBlur(BLOOM_RADIUS)), float) * BLOOM_STRENGTH
    return Image.fromarray(np.clip(np.asarray(picture, float) + glow, 0, 255).astype(np.uint8))


def limits_of(image: np.ndarray) -> tuple[float, float]:
    low, high = np.nanpercentile(image, [LOW_PERCENTILE, HIGH_PERCENTILE])
    return float(low), float(max(high, low + 1e-6))


def plate_fraction(grid, ra: float, dec: float) -> dict:
    x, y = grid.wcs.all_world2pix(ra, dec, 0)
    return {"x": round((float(x) + 0.5) / grid.n, 4), "y": round(1 - (float(y) + 0.5) / grid.n, 4)}


def _mover_pair(preset, job, frames):
    """AllWISE in 2010 against the latest SPHEREx date at about the same wavelength."""
    from backend.coords import propagate

    red = [frame for frame in frames if frame.meta["detector"] in (5, 6)]
    last_visit = max(frame.meta["visit"] for frame in red)
    late = [frame for frame in red if frame.meta["visit"] == last_visit]
    year_mjd = float(np.mean([frame.meta["mjd"] for frame in late]))
    _, wise_pixels = wise.frame(job.grid)
    now = median_stack(late)
    then_position = propagate(preset.ra, preset.dec, preset.pmra, preset.pmdec, preset.epoch, 55378.0)
    now_position = propagate(preset.ra, preset.dec, preset.pmra, preset.pmdec, preset.epoch, year_mjd)
    return (
        (wise_pixels, "2010", plate_fraction(job.grid, *then_position)),
        (now, str(round(2000 + (year_mjd - 51544.5) / 365.25)), plate_fraction(job.grid, *now_position)),
        MOVER_TINT,
    )


def _variable_pair(preset, job, frames):
    """The faintest and brightest dates of a variable star, both in one array."""
    from backend.processing import aperture_flux

    ra, dec = preset.centre()
    x, y = job.grid.wcs.all_world2pix(ra, dec, 0)
    band = [frame for frame in frames if frame.meta["detector"] == 2]
    measured = []
    for visit in sorted({frame.meta["visit"] for frame in band}):
        members = [frame for frame in band if frame.meta["visit"] == visit]
        stack = median_stack(members)
        flux = aperture_flux(stack, np.zeros(stack.shape, np.uint8), job.grid, float(x), float(y))
        if flux:
            year = 2000 + (float(np.mean([frame.meta["mjd"] for frame in members])) - 51544.5) / 365.25
            measured.append((flux[0], stack, year))
    measured.sort(key=lambda item: item[0])
    position = plate_fraction(job.grid, ra, dec)
    faint, bright = measured[0], measured[-1]
    return (
        (faint[1], f"{faint[2]:.1f}", position),
        (bright[1], f"{bright[2]:.1f}", position),
        VARIABLE_TINT,
    )


def write_thumbnails(preset, job, frames, folder: Path) -> dict:
    is_mover = math.hypot(preset.pmra, preset.pmdec) > FAST_MOVER_MAS
    first, second, tint = (_mover_pair if is_mover else _variable_pair)(preset, job, frames)
    # Each survey has its own units, so movers get one stretch per image; variables share one.
    shared = limits_of(np.concatenate([first[0].ravel(), second[0].ravel()]))
    records = []
    for tag, (image, label, position) in zip("ab", (first, second)):
        limits = limits_of(image) if is_mover else shared
        name = f"thumb-{tag}.webp"
        hot_image(image, tint, limits).save(folder / name, quality=THUMB_QUALITY)
        records.append({"file": name, "label": label, **position})
    return {"kind": "mover" if is_mover else "variable", "frames": records}


def build(preset) -> dict:
    ra, dec = preset.centre()
    job = Job(ra, dec, preset.fov)
    job.run()
    if job.status != "done" or not job.frames:
        raise RuntimeError(f"{preset.key}: {job.status} {job.error}")
    frames = sorted(job.frames, key=lambda frame: frame.meta["mjd"])
    folder = OUTPUT / preset.key
    folder.mkdir(parents=True, exist_ok=True)
    scales = [soft_scale_of(frame.pixels) for frame in frames]
    pixels = b"".join(encode(frame.pixels, scale) for frame, scale in zip(frames, scales))
    masks = b"".join(frame.mask.astype(np.uint8).tobytes() for frame in frames)
    (folder / "frames.bin.gz").write_bytes(gzip.compress(pixels + masks, 9, mtime=0))
    _, wise_pixels = wise.frame(job.grid)
    wise_scale = soft_scale_of(wise_pixels)
    (folder / "wise.bin.gz").write_bytes(gzip.compress(encode(wise_pixels, wise_scale), 9, mtime=0))
    grid = {"ra": job.grid.ra, "dec": job.grid.dec, "fov": job.grid.fov, "n": job.grid.n, "scale": job.grid.scale}
    meta = {
        "grid": grid,
        "available": job.available,
        "total": job.total,
        "step": ENCODE_STEP,
        "frames": [{**frame.meta, "soft": scale} for frame, scale in zip(frames, scales)],
        "wise": {"year": wise.ALLWISE_MEAN_YEAR, "soft": wise_scale},
        "gaia": gaia.nearby(ra, dec, preset.fov),
        "thumbs": write_thumbnails(preset, job, frames, folder),
    }
    (folder / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    return {"key": preset.key, "frames": len(frames)}


if __name__ == "__main__":
    print([build(preset) for preset in PRESETS], flush=True)
