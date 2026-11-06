import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS

from backend.processing import (
    Grid,
    Native,
    aperture_flux,
    channel_index,
    contaminated_mask,
    group_visits,
    reproject,
    wavelength_on_plate,
)


def make_wcs(ra=10.0, dec=0.0, n=41, scale=6.15 / 3600):
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [ra, dec]
    wcs.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    wcs.wcs.cdelt = [-scale, scale]
    return wcs


def make_native(image, bad=None):
    return Native(
        image=image,
        bad=np.zeros(image.shape, bool) if bad is None else bad,
        wcs=make_wcs(n=image.shape[0]),
        wave_wcs=None,
    )


def test_flags_treat_defects_as_bad_but_not_source_marks():
    header = fits.Header()
    header["HIERARCH MP_HOT"] = 10
    header["HIERARCH MP_SOURCE"] = 21
    flags = np.array([[0, 1 << 10, 1 << 21, (1 << 21) | (1 << 10)]])
    assert contaminated_mask(flags, header).tolist() == [[False, True, False, True]]


def test_visits_split_on_time_gaps():
    assert group_visits([60800, 60801, 60990, 60991, 61150]) == [0, 0, 1, 1, 2]


def test_visits_split_when_continuous_coverage_runs_too_long():
    mjds = list(range(61000, 61100, 2))
    visits = group_visits(mjds)
    assert visits[0] == 0
    assert max(visits) >= 1
    assert visits == sorted(visits)


def test_visits_keep_input_order_for_unsorted_times():
    assert group_visits([61150, 60800, 60801]) == [1, 0, 0]


@pytest.mark.parametrize(
    "lam,detector,expected",
    [(0.76, 1, 0), (1.09, 1, 16), (4.43, 6, 85), (4.99, 6, 101)],
)
def test_channel_index_spans_all_102_bands(lam, detector, expected):
    assert channel_index(lam, detector) == expected


def test_grid_is_north_up_east_left_with_sensible_size():
    grid = Grid.for_fov(10.0, 0.0, 0.1)
    assert grid.n == 120
    ra_l, _ = grid.wcs.all_pix2world(0, grid.n / 2, 0)
    ra_r, _ = grid.wcs.all_pix2world(grid.n - 1, grid.n / 2, 0)
    assert ra_l > ra_r


def test_grid_caps_pixel_count_for_wide_fields():
    assert Grid.for_fov(10.0, 0.0, 0.5).n == 160


def test_reproject_places_source_at_its_sky_position():
    image = np.zeros((41, 41))
    image[20, 20] = 100.0
    frame, mask = reproject(make_native(image), Grid.for_fov(10.0, 0.0, 0.05))
    y, x = np.unravel_index(np.nanargmax(frame), frame.shape)
    assert abs(x - 29.5) <= 1 and abs(y - 29.5) <= 1
    assert frame.dtype == np.float32
    assert mask.dtype == np.uint8


def test_reproject_marks_area_outside_the_cutout_as_nan():
    frame, _ = reproject(make_native(np.ones((5, 5))), Grid.for_fov(10.0, 0.0, 0.1))
    assert np.isnan(frame[0, 0])


def make_plate(fov=0.05, background=2.0):
    grid = Grid.for_fov(10.0, 0.0, fov)
    return grid, np.full((grid.n, grid.n), background, np.float32), np.zeros((grid.n, grid.n), np.uint8)


def test_aperture_flux_sums_source_above_background():
    grid, pixels, mask = make_plate()
    pixels[30, 30] = 12.0
    flux, error, flagged = aperture_flux(pixels, mask, grid, 30.0, 30.0)
    pixel_sr = (grid.scale * 3600 / 206265) ** 2
    assert flux == pytest.approx(10.0 * pixel_sr * 1e12, rel=0.01)
    assert error >= 0
    assert flagged is False


def test_aperture_flux_uses_scatter_in_the_annulus_as_noise():
    grid, pixels, mask = make_plate()
    noisy = pixels + np.random.default_rng(1).normal(0, 1, pixels.shape).astype(np.float32)
    _, error, _ = aperture_flux(noisy, mask, grid, 30.0, 30.0)
    assert error > 0


def test_aperture_flux_reports_flagged_pixels_inside_aperture():
    grid, pixels, mask = make_plate()
    mask[30, 31] = 1
    _, _, flagged = aperture_flux(pixels, mask, grid, 30.0, 30.0)
    assert flagged is True


def test_aperture_flux_is_none_when_position_has_no_data():
    grid, pixels, mask = make_plate()
    pixels[:] = np.nan
    assert aperture_flux(pixels, mask, grid, 30.0, 30.0) is None


def test_aperture_flux_is_none_off_the_plate():
    grid, pixels, mask = make_plate()
    assert aperture_flux(pixels, mask, grid, 500.0, 30.0) is None


def test_wavelength_varies_linearly_across_the_plate():
    meta = {"wavelength": 2.0, "waveDx": 0.01, "waveDy": -0.02}
    assert wavelength_on_plate(meta, Grid.for_fov(10.0, 0.0, 0.05), 39.5, 19.5) == pytest.approx(2.0 + 0.1 + 0.2)
