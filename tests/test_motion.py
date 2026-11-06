import numpy as np
import pytest

from backend.motion import centroid, fit_proper_motion, find_control_stars


def gaussian(n, x0, y0, peak=100.0, sigma=2.5):
    yy, xx = np.mgrid[:n, :n]
    return peak * np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2 * sigma**2))


def test_centroid_recovers_subpixel_position():
    x, y = centroid(gaussian(41, 20.3, 18.7), 19.0, 20.0, 6)
    assert x == pytest.approx(20.3, abs=0.05)
    assert y == pytest.approx(18.7, abs=0.05)


def test_centroid_returns_none_when_window_is_empty():
    assert centroid(np.full((41, 41), np.nan), 20, 20, 6) is None


def test_fit_recovers_known_motion():
    years = np.array([2025.4, 2025.9, 2026.4])
    east = 4.0 * (years - 2025.4)
    north = -8.0 * (years - 2025.4)
    fit = fit_proper_motion(years, east, north, np.full(3, 0.1))
    assert fit.pm_east == pytest.approx(4.0, abs=1e-6)
    assert fit.pm_north == pytest.approx(-8.0, abs=1e-6)
    assert fit.total == pytest.approx(np.hypot(4, 8), abs=1e-6)
    assert fit.total_err > 0


def test_fit_requires_two_epochs():
    with pytest.raises(ValueError):
        fit_proper_motion(np.array([2025.0]), np.zeros(1), np.zeros(1), np.ones(1))


def test_control_stars_exclude_the_target_region():
    image = gaussian(81, 40, 40, peak=500) + gaussian(81, 15, 60, peak=100)
    stars = find_control_stars(image, (40, 40), count=1)
    assert len(stars) == 1
    assert stars[0] == pytest.approx((15, 60), abs=1)
