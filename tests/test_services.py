from backend import gaia, hips, wise
from backend.presets import PRESETS, find_preset
from backend.resolver import parse_sesame


def test_hips_proxy_only_allows_survey_tile_paths():
    assert hips.is_allowed("Norder3/Dir0/Npix100.jpg")
    assert hips.is_allowed("properties")
    assert not hips.is_allowed("../secret")
    assert not hips.is_allowed("Norder3/Dir0/../../etc.jpg")
    assert not hips.is_allowed("http://evil/x.jpg")


def test_gaia_csv_keeps_motion_and_skips_broken_rows():
    text = "ra,dec,phot_g_mean_mag,pmra,pmdec\n1.5,2.5,8.1,-801.5,10362\n1,2,,0,0\n3,4,9.0,,\n"
    stars = gaia.parse_csv(text)
    assert stars[0]["pmdec"] == 10362
    assert [star["g"] for star in stars] == [8.1, 9.0]
    assert stars[1]["pmra"] == 0


def test_sesame_output_gives_position_and_motion():
    text = "# RW Aur\n%J 76.95 +30.40 = 05 07\n%P -1.5 2.5 [0.1 0.1 0] A\n"
    assert parse_sesame(text) == {"ra": 76.95, "dec": 30.40, "pmra": -1.5, "pmdec": 2.5, "epoch": 2000.0}


def test_sesame_output_without_position_is_not_found():
    assert parse_sesame("#!SIMBAD: No known catalog\n") is None


def test_wise_cutout_url_follows_coadd_directory_layout():
    url = wise.coadd_url("1342m076_ac51", 133.5, -7.25, 0.145)
    assert "/13/1342/1342m076_ac51/1342m076_ac51-w2-int-3.fits?center=133.5,-7.25&size=0.145deg" in url


def test_every_challenge_target_is_available_by_name():
    names = {"barnard's star", "epsilon indi b", "wise 0855", "rw aurigae", "r draconis"}
    assert {find_preset(name).name.lower() for name in names} == names
    assert len(PRESETS) == 5


def test_target_lookup_ignores_case_and_spacing():
    assert find_preset("  WISE   0855 ").key == "wise0855"
