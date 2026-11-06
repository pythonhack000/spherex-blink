"""Turns a typed object name into a position with proper motion."""
import logging
import re
from urllib.parse import quote

import httpx

from . import config
from .presets import find_preset

log = logging.getLogger("blink.resolver")
_POSITION = re.compile(r"^%J\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)", re.M)
_MOTION = re.compile(r"^%P\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)", re.M)
SIMBAD_EPOCH = 2000.0
LOOKUP_TIMEOUT_SECONDS = 12


def parse_sesame(text: str) -> dict | None:
    position = _POSITION.search(text)
    if not position:
        return None
    motion = _MOTION.search(text)
    return {
        "ra": float(position[1]),
        "dec": float(position[2]),
        "pmra": float(motion[1]) if motion else 0.0,
        "pmdec": float(motion[2]) if motion else 0.0,
        "epoch": SIMBAD_EPOCH,
    }


def resolve(query: str) -> dict | None:
    preset = find_preset(query)
    if preset:
        return preset.to_json()
    response = httpx.get(
        f"{config.SESAME_URL}?{quote(query)}",
        timeout=LOOKUP_TIMEOUT_SECONDS,
        follow_redirects=True,
    )
    response.raise_for_status()
    found = parse_sesame(response.text)
    return {**found, "name": query} if found else None
