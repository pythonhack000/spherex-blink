import pytest
from backend.coords import parse_position, propagate, mjd_to_year, tangent_offset_arcsec


def test_parses_decimal_degrees():
    assert parse_position("133.7951 -7.2451") == pytest.approx((133.7951, -7.2451))


def test_parses_challenge_sexagesimal_for_wise_0855():
    ra, dec = parse_position("08h55m10.831s -7d14m42.53s")
    assert ra == pytest.approx(133.79513, abs=1e-4)
    assert dec == pytest.approx(-7.24515, abs=1e-4)


def test_parses_colon_sexagesimal_as_hours():
    ra, _ = parse_position("08:55:10.831 -07:14:42.53")
    assert ra == pytest.approx(133.79513, abs=1e-4)


@pytest.mark.parametrize("text", ["", "banana", "400 0", "10 95"])
def test_rejects_invalid_positions(text):
    with pytest.raises(ValueError):
        parse_position(text)


def test_mjd_to_year_at_j2000():
    assert mjd_to_year(51544.5) == pytest.approx(2000.0)


def test_propagate_moves_declination_by_proper_motion():
    mjd_2010 = 51544.5 + 3652.5
    ra, dec = propagate(10.0, 0.0, 0.0, 3600.0, 2000.0, mjd_2010)
    assert ra == pytest.approx(10.0)
    assert dec == pytest.approx(36.0 / 3600.0)


def test_propagate_applies_cos_dec_to_right_ascension():
    mjd_2001 = 51544.5 + 365.25
    ra, _ = propagate(10.0, 60.0, 3600.0, 0.0, 2000.0, mjd_2001)
    assert ra == pytest.approx(10.0 + 7.2 / 3600.0, abs=1e-6)


def test_tangent_offset_east_and_north_are_positive():
    east, north = tangent_offset_arcsec(10.0, 0.0, 10.0 + 1 / 3600, 1 / 3600)
    assert east == pytest.approx(1.0, abs=1e-3)
    assert north == pytest.approx(1.0, abs=1e-3)
