"""Sky coordinate parsing and linear proper-motion propagation."""
import math
import re

from astropy import units as u
from astropy.coordinates import SkyCoord

MJD_J2000 = 51544.5
DAYS_PER_YEAR = 365.25
MAS_PER_DEG = 3.6e6
ARCSEC_PER_DEG = 3600.0
_DECIMAL_PAIR = re.compile(r"^\s*([+-]?\d+(?:\.\d*)?)[\s,]+([+-]?\d+(?:\.\d*)?)\s*$")


def parse_position(text: str) -> tuple[float, float]:
    """Read 'ra dec' as decimal degrees or sexagesimal (RA in hours)."""
    match = _DECIMAL_PAIR.match(text or "")
    try:
        if match:
            coord = SkyCoord(float(match[1]), float(match[2]), unit="deg")
        else:
            coord = SkyCoord(text, unit=(u.hourangle, u.deg))
    except Exception as error:
        raise ValueError(f"Cannot read coordinates: {text!r}") from error
    if match and not 0 <= float(match[1]) <= 360:
        raise ValueError(f"Right ascension out of range: {text!r}")
    return float(coord.ra.deg), float(coord.dec.deg)


def mjd_to_year(mjd: float) -> float:
    return 2000.0 + (mjd - MJD_J2000) / DAYS_PER_YEAR


def propagate(
    ra: float, dec: float, pmra: float, pmdec: float, epoch: float, mjd: float
) -> tuple[float, float]:
    """Move a position by proper motion (mas/yr; pmra includes cos dec)."""
    years = mjd_to_year(mjd) - epoch
    cos_dec = max(math.cos(math.radians(dec)), 1e-6)
    return (
        ra + pmra * years / MAS_PER_DEG / cos_dec,
        dec + pmdec * years / MAS_PER_DEG,
    )


def tangent_offset_arcsec(
    ra0: float, dec0: float, ra: float, dec: float
) -> tuple[float, float]:
    """Small-angle (east, north) offset of (ra, dec) from (ra0, dec0)."""
    delta_ra = ((ra - ra0 + 180.0) % 360.0) - 180.0
    return (
        delta_ra * math.cos(math.radians(dec0)) * ARCSEC_PER_DEG,
        (dec - dec0) * ARCSEC_PER_DEG,
    )
