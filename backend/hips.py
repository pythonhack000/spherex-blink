"""Same-origin, cached proxy for the all-sky AllWISE tiles hosted by IRSA."""
import re

import httpx

from . import config
from .archive import _write_atomic

BASE_URL = "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1/"
_ALLOWED_PATH = re.compile(r"^(properties|Moc\.fits|Norder\d+/Allsky\.jpg|Norder\d+/Dir\d+/Npix\d+\.jpg)$")
_MEDIA_TYPES = {"jpg": "image/jpeg", "fits": "application/fits"}


def is_allowed(path: str) -> bool:
    return bool(_ALLOWED_PATH.match(path))


def media_type(path: str) -> str:
    return _MEDIA_TYPES.get(path.rsplit(".", 1)[-1], "text/plain")


def tile(path: str) -> bytes | None:
    """Return tile bytes, or None when the survey has no such tile."""
    cached = config.CACHE_DIR / "hips" / path
    if cached.exists():
        return cached.read_bytes()
    response = httpx.get(BASE_URL + path, timeout=30, follow_redirects=True)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    _write_atomic(cached, response.content)
    return response.content
