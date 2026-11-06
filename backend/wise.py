"""AllWISE W2 (4.6 um, about 2010) on the plate grid: a 16-year-old reference frame."""
import csv
import io

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from . import config
from .archive import _download, _write_atomic
from .processing import Grid, Native, reproject

SEARCH_URL = "https://irsa.ipac.caltech.edu/ibe/search/wise/allwise/p3am_cdd"
DATA_URL = "https://irsa.ipac.caltech.edu/ibe/data/wise/allwise/p3am_cdd"
ALLWISE_MEAN_YEAR = 2010.5
WISE_WAVELENGTH_UM = 4.6


def coadd_url(coadd_id: str, ra: float, dec: float, size_deg: float) -> str:
    return (
        f"{DATA_URL}/{coadd_id[:2]}/{coadd_id[:4]}/{coadd_id}/{coadd_id}-w2-int-3.fits"
        f"?center={round(ra, 5)},{round(dec, 5)}&size={round(size_deg, 4)}deg"
    )


def _cutout_path(client: httpx.Client, grid: Grid):
    size = grid.fov * config.CUTOUT_MARGIN
    path = config.CACHE_DIR / "wise" / f"{grid.ra:.4f}_{grid.dec:.4f}_{size:.3f}.fits"
    if path.exists():
        return path
    response = client.get(
        SEARCH_URL,
        params={"POS": f"{grid.ra},{grid.dec}", "ct": "csv", "where": "band IN (2)", "columns": "coadd_id,band"},
    )
    response.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(response.text)))
    if not rows:
        raise LookupError("AllWISE does not cover this position")
    _write_atomic(path, _download(client, coadd_url(rows[0]["coadd_id"], grid.ra, grid.dec, size)))
    return path


def frame(grid: Grid) -> tuple[dict, np.ndarray]:
    """Return frame metadata and float32 pixels on the shared grid."""
    with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
        path = _cutout_path(client, grid)
    with fits.open(path) as hdus:
        image = hdus[0].data.astype(np.float64)
        wcs = WCS(hdus[0].header)
    finite = np.isfinite(image)
    level = np.median(image[finite]) if finite.any() else 0.0
    native = Native(
        image=np.where(finite, image - level, np.nan),
        bad=~finite,
        wcs=wcs,
        wave_wcs=None,
    )
    pixels, _ = reproject(native, grid)
    return {"year": ALLWISE_MEAN_YEAR, "wavelength": WISE_WAVELENGTH_UM, "label": "AllWISE"}, pixels
