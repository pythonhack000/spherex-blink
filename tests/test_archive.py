from backend.archive import (
    Exposure,
    dedupe_latest,
    parse_collections,
    parse_sia_csv,
    cutout_url,
)

HEADER = "energy_bandpassname,obs_id,em_min,em_max,access_url,t_min,t_exptime,obs_collection,cloud_access,o_ucd\n"
ROW = (
    "SPHEREx-D6,2026W33_2A_0594_4,4.4e-06,5.0e-06,https://x/a.fits,61268.63,113.5,"
    'spherex_qr3,{"aws": {"bucket_name": "b","key":"k"}},\n'
)


def make_exposure(obs_id="o1", detector=1, collection="spherex_qr2", mjd=61000.0):
    return Exposure(obs_id, detector, mjd, 0.75, 1.1, "https://x/a.fits", collection)


def test_parses_sia_row_into_exposure_in_micrometres():
    [exposure] = parse_sia_csv(HEADER + ROW)
    assert exposure.detector == 6
    assert exposure.obs_id == "2026W33_2A_0594_4"
    assert round(exposure.wave_min_um, 2) == 4.4
    assert exposure.collection == "spherex_qr3"


def test_skips_rows_without_a_detector_band():
    assert parse_sia_csv(HEADER + ROW.replace("SPHEREx-D6", "other")) == []


def test_finds_wide_and_deep_quick_releases_in_self_description():
    xml = '<OPTION value="akari"/><OPTION value="spherex_qr2"/><OPTION value="spherex_qr10_deep"/><OPTION value="spherex_other"/>'
    assert parse_collections(xml) == ("spherex_qr2", "spherex_qr10_deep")


def test_newer_release_replaces_same_exposure():
    old = make_exposure(collection="spherex_qr2")
    new = make_exposure(collection="spherex_qr10")
    assert dedupe_latest([old, new]) == [new]
    assert dedupe_latest([new, old]) == [new]


def test_different_detectors_are_different_exposures():
    assert len(dedupe_latest([make_exposure(detector=1), make_exposure(detector=2)])) == 2


def test_cutout_url_uses_documented_center_and_size():
    url = cutout_url(make_exposure(), 133.5, -7.25, 0.1)
    assert url == "https://x/a.fits?center=133.5,-7.25&size=0.1"
