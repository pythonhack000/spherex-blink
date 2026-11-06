"""Turns SPHEREx cutouts into aligned frames and aperture photometry."""
import io
import math
import warnings
from dataclasses import dataclass

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

warnings.filterwarnings("ignore", module="astropy.wcs")

# Inclusive wavelength limits (um) of the six detector arrays.
DETECTOR_RANGES = {
    1: (0.75, 1.09),
    2: (1.10, 1.62),
    3: (1.63, 2.41),
    4: (2.42, 3.82),
    5: (3.83, 4.41),
    6: (4.42, 5.00),
}
CHANNELS_PER_DETECTOR = 17
VISIT_GAP_DAYS = 30.0
VISIT_MAX_SPAN_DAYS = 75.0
PLATE_SCALE_ARCSEC = 3.0
MAX_PLATE_PIXELS = 160
MJY_SR_TO_UJY_PER_SR = 1e12
APERTURE_RADIUS_ARCSEC = 7.0
ANNULUS_ARCSEC = (24.0, 42.0)
NATIVE_PIXEL_ARCSEC = 6.15
MIN_ANNULUS_PIXELS = 5
# Marks that describe the pixel without saying its value is wrong.
BENIGN_FLAGS = {"MP_SOURCE", "MP_FULLSAMPLE", "MP_PHANMISS", "MP_DICHROIC"}


@dataclass(frozen=True)
class Native:
    """One exposure in its own pixel grid, with zodiacal light removed."""

    image: np.ndarray
    bad: np.ndarray
    wcs: WCS
    wave_wcs: WCS | None


@dataclass(frozen=True)
class Grid:
    """North-up, east-left tangent-plane grid shared by every frame."""

    ra: float
    dec: float
    fov: float
    n: int
    scale: float
    wcs: WCS

    @classmethod
    def for_fov(cls, ra: float, dec: float, fov: float) -> "Grid":
        wanted = math.ceil(round(fov * 3600 / PLATE_SCALE_ARCSEC, 6))
        n = min(MAX_PLATE_PIXELS, wanted)
        scale = fov / n
        wcs = WCS(naxis=2)
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wcs.wcs.crval = [ra, dec]
        wcs.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
        wcs.wcs.cdelt = [-scale, scale]
        return cls(ra, dec, fov, n, scale, wcs)


def contaminated_mask(flags: np.ndarray, header: fits.Header) -> np.ndarray:
    """Pixels whose value should not be trusted, using the file's own bit table."""
    bits = 0
    for key, value in header.items():
        if key.startswith("MP_") and key not in BENIGN_FLAGS:
            bits |= 1 << int(value)
    return (flags.astype(np.int64) & bits) != 0


def group_visits(mjds: list[float]) -> list[int]:
    """Assign each time to a visit; returned list follows the input order."""
    order = sorted(range(len(mjds)), key=lambda index: mjds[index])
    visits = [0] * len(mjds)
    current, start, previous = 0, None, None
    for index in order:
        mjd = mjds[index]
        if start is None:
            start = mjd
        elif mjd - previous > VISIT_GAP_DAYS or mjd - start > VISIT_MAX_SPAN_DAYS:
            current, start = current + 1, mjd
        visits[index], previous = current, mjd
    return visits


def channel_index(wavelength_um: float, detector: int) -> int:
    """Map a wavelength onto the 0-101 band number, 17 log-spaced per array."""
    low, high = DETECTOR_RANGES[detector]
    fraction = math.log(wavelength_um / low) / math.log(high / low)
    within = min(CHANNELS_PER_DETECTOR - 1, max(0, int(fraction * CHANNELS_PER_DETECTOR)))
    return (detector - 1) * CHANNELS_PER_DETECTOR + within


def load_native(fits_bytes: bytes) -> Native:
    with fits.open(io.BytesIO(fits_bytes)) as hdus:
        science = hdus["IMAGE"].data.astype(np.float64) - hdus["ZODI"].data.astype(np.float64)
        bad = contaminated_mask(hdus["FLAGS"].data, hdus["FLAGS"].header)
        wcs = WCS(hdus["IMAGE"].header)
        wave_wcs = WCS(hdus["IMAGE"].header, fobj=hdus, key="W")
        wave_wcs.sip = None
    finite = np.isfinite(science)
    level = np.median(science[finite & ~bad]) if np.any(finite & ~bad) else 0.0
    return Native(np.where(finite, science - level, np.nan), bad | ~finite, wcs, wave_wcs)


def wavelength_at(native: Native, ra: float, dec: float) -> float | None:
    """Central wavelength (um) that this exposure recorded at a sky position."""
    x, y = native.wcs.all_world2pix(ra, dec, 0)
    wavelength, _ = native.wave_wcs.pixel_to_world(float(x), float(y))
    value = float(wavelength.to("um").value)
    return value if math.isfinite(value) else None


def reproject(native: Native, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Resample onto the shared grid; returns (float32 frame, uint8 bad mask)."""
    rows, cols = np.mgrid[: grid.n, : grid.n]
    ra, dec = grid.wcs.all_pix2world(cols, rows, 0)
    x, y = native.wcs.all_world2pix(ra, dec, 0)
    height, width = native.image.shape
    outside = (x < -0.5) | (y < -0.5) | (x > width - 0.5) | (y > height - 0.5)
    filled = np.nan_to_num(native.image, nan=0.0)
    frame = map_coordinates(filled, [y, x], order=1, mode="nearest").astype(np.float32)
    bad = map_coordinates(native.bad.astype(np.uint8), [y, x], order=0, mode="nearest")
    return np.where(outside, np.nan, frame).astype(np.float32), bad.astype(np.uint8)


def wavelength_gradient(native: Native, grid: Grid) -> tuple[float, float]:
    """Change in wavelength (um) per plate pixel, along plate x and plate y."""
    step = grid.fov / 4
    centre = wavelength_at(native, grid.ra, grid.dec)
    cos_dec = max(math.cos(math.radians(grid.dec)), 1e-6)
    west = wavelength_at(native, grid.ra - step / cos_dec, grid.dec)
    north = wavelength_at(native, grid.ra, grid.dec + step)
    pixels = step / grid.scale
    if centre is None or west is None or north is None:
        return 0.0, 0.0
    return (west - centre) / pixels, (north - centre) / pixels


def wavelength_on_plate(meta: dict, grid: Grid, x: float, y: float) -> float:
    """Wavelength recorded at a plate position; it changes slowly across a small field."""
    centre = (grid.n - 1) / 2
    return meta["wavelength"] + meta["waveDx"] * (x - centre) + meta["waveDy"] * (y - centre)


def aperture_flux(
    pixels: np.ndarray, mask: np.ndarray, grid: Grid, x: float, y: float
) -> tuple[float, float, bool] | None:
    """Annulus-subtracted flux in uJy, its noise, and whether flagged pixels are inside."""
    if not (0 <= x < grid.n and 0 <= y < grid.n):
        return None
    arcsec_per_pixel = grid.scale * 3600
    rows, cols = np.mgrid[: grid.n, : grid.n]
    distance = np.hypot(cols - x, rows - y) * arcsec_per_pixel
    finite = np.isfinite(pixels)
    aperture = (distance <= max(APERTURE_RADIUS_ARCSEC, arcsec_per_pixel * 1.5)) & finite
    annulus = (distance >= ANNULUS_ARCSEC[0]) & (distance <= ANNULUS_ARCSEC[1]) & finite & (mask == 0)
    if annulus.sum() < MIN_ANNULUS_PIXELS or not aperture.any():
        return None
    values = pixels[annulus]
    to_ujy = math.radians(grid.scale) ** 2 * MJY_SR_TO_UJY_PER_SR
    flux = float(np.sum(pixels[aperture] - np.median(values)) * to_ujy)
    # Plate pixels oversample the detector, so count independent native pixels for the noise.
    independent = max(1.0, aperture.sum() * (arcsec_per_pixel / NATIVE_PIXEL_ARCSEC) ** 2)
    native_sr = math.radians(NATIVE_PIXEL_ARCSEC / 3600) ** 2
    error = float(np.std(values) * math.sqrt(independent) * native_sr * MJY_SR_TO_UJY_PER_SR)
    return flux, error, bool(np.any(mask[aperture]))
