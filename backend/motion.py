"""Measures proper motion from per-visit stacks of aligned frames."""
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import maximum_filter

CENTROID_ITERATIONS = 10
CENTROID_CONVERGED_PX = 0.01
EDGE_MARGIN_PX = 8
TARGET_EXCLUSION_PX = 15
PEAK_WINDOW_PX = 7
PEAK_SIGMA_THRESHOLD = 5.0
MAD_TO_SIGMA = 1.4826


@dataclass(frozen=True)
class MotionFit:
    pm_east: float
    pm_north: float
    err_east: float
    err_north: float
    total: float
    total_err: float


def centroid(image: np.ndarray, x0: float, y0: float, radius: float) -> tuple[float, float] | None:
    """Gaussian-weighted centroid, iterated from a starting guess."""
    rows, cols = np.mgrid[: image.shape[0], : image.shape[1]]
    x, y = float(x0), float(y0)
    for _ in range(CENTROID_ITERATIONS):
        distance_sq = (cols - x) ** 2 + (rows - y) ** 2
        window = (distance_sq <= radius**2) & np.isfinite(image)
        if not window.any():
            return None
        signal = np.clip(image[window] - np.median(image[window]), 0, None)
        weights = signal * np.exp(-distance_sq[window] / (2 * (radius / 2) ** 2))
        total = weights.sum()
        if total <= 0:
            return None
        new_x = float((cols[window] * weights).sum() / total)
        new_y = float((rows[window] * weights).sum() / total)
        moved = np.hypot(new_x - x, new_y - y)
        x, y = new_x, new_y
        if moved < CENTROID_CONVERGED_PX:
            break
    return x, y


def _fit_axis(years: np.ndarray, values: np.ndarray, weights: np.ndarray) -> tuple[float, float]:
    mean_year = np.sum(weights * years) / np.sum(weights)
    spread = np.sum(weights * (years - mean_year) ** 2)
    slope = np.sum(weights * (years - mean_year) * values) / spread
    return float(slope), float(np.sqrt(1 / spread))


def fit_proper_motion(
    years: np.ndarray, east: np.ndarray, north: np.ndarray, sigma: np.ndarray
) -> MotionFit:
    """Weighted straight-line fit of offsets (arcsec) against time (years)."""
    if len(np.unique(years)) < 2:
        raise ValueError("Motion needs at least two different epochs")
    weights = 1 / np.square(sigma)
    pm_east, err_east = _fit_axis(years, east, weights)
    pm_north, err_north = _fit_axis(years, north, weights)
    total = float(np.hypot(pm_east, pm_north))
    total_err = (
        float(np.hypot(pm_east * err_east, pm_north * err_north) / total)
        if total > 0
        else float(np.hypot(err_east, err_north))
    )
    return MotionFit(pm_east, pm_north, err_east, err_north, total, total_err)


def find_control_stars(
    image: np.ndarray, target_xy: tuple[float, float], count: int = 4
) -> list[tuple[float, float]]:
    """Brightest isolated peaks away from the target, used as a motion zero check."""
    filled = np.nan_to_num(image, nan=float(np.nanmedian(image)))
    level = np.median(filled)
    noise = MAD_TO_SIGMA * np.median(np.abs(filled - level))
    is_peak = (filled == maximum_filter(filled, size=PEAK_WINDOW_PX)) & (
        filled > level + PEAK_SIGMA_THRESHOLD * noise
    )
    rows, cols = np.nonzero(is_peak)
    height, width = image.shape
    candidates = [
        (float(x), float(y), float(filled[y, x]))
        for y, x in zip(rows, cols)
        if EDGE_MARGIN_PX <= x < width - EDGE_MARGIN_PX
        and EDGE_MARGIN_PX <= y < height - EDGE_MARGIN_PX
        and np.hypot(x - target_xy[0], y - target_xy[1]) > TARGET_EXCLUSION_PX
    ]
    candidates.sort(key=lambda item: -item[2])
    return [(x, y) for x, y, _ in candidates[:count]]
