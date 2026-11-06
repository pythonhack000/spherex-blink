"""Access to the IRSA SPHEREx archive: release discovery, search and cutouts."""
import csv
import io
import json
import logging
import random
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from . import config

log = logging.getLogger("blink.archive")
_COLLECTION = re.compile(r'value="(spherex_qr\d+(?:_deep)?)"')
_RELEASE_NUMBER = re.compile(r"spherex_qr(\d+)")
_DETECTOR = re.compile(r"^SPHEREx-D([1-6])$")
METRES_TO_UM = 1e6


@dataclass(frozen=True)
class Exposure:
    obs_id: str
    detector: int
    mjd: float
    wave_min_um: float
    wave_max_um: float
    url: str
    collection: str


def parse_collections(self_description: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(_COLLECTION.findall(self_description)))


def parse_sia_csv(text: str) -> list[Exposure]:
    return [
        exposure
        for row in csv.DictReader(io.StringIO(text))
        if (exposure := _row_to_exposure(row)) is not None
    ]


def _row_to_exposure(row: dict) -> Exposure | None:
    match = _DETECTOR.match(row.get("energy_bandpassname") or "")
    if not match:
        return None
    try:
        return Exposure(
            obs_id=row["obs_id"],
            detector=int(match[1]),
            mjd=float(row["t_min"]),
            wave_min_um=float(row["em_min"]) * METRES_TO_UM,
            wave_max_um=float(row["em_max"]) * METRES_TO_UM,
            url=row["access_url"],
            collection=row["obs_collection"],
        )
    except (KeyError, TypeError, ValueError) as error:
        log.warning("Skipping malformed archive row: %s", error)
        return None


def _release_number(collection: str) -> int:
    match = _RELEASE_NUMBER.match(collection)
    return int(match[1]) if match else -1


def dedupe_latest(exposures: list[Exposure]) -> list[Exposure]:
    """Keep the newest quick release of every (exposure, detector) pair."""
    best: dict[tuple[str, int], Exposure] = {}
    for exposure in exposures:
        key = (exposure.obs_id, exposure.detector)
        held = best.get(key)
        if held is None or _release_number(exposure.collection) > _release_number(
            held.collection
        ):
            best[key] = exposure
    return list(best.values())


def cutout_url(exposure: Exposure, ra: float, dec: float, size_deg: float) -> str:
    return f"{exposure.url}?center={round(ra, 5)},{round(dec, 5)}&size={round(size_deg, 4)}"


def exposure_key(exposure: Exposure) -> str:
    return f"{exposure.obs_id}_D{exposure.detector}_{_release_number(exposure.collection)}"


def discover_collections(client: httpx.Client) -> tuple[str, ...]:
    """Ask the archive which SPHEREx releases exist, so new ones appear unaided."""
    path = config.CACHE_DIR / "collections.json"
    if _is_fresh(path):
        return tuple(json.loads(path.read_text()))
    try:
        response = client.get(
            config.IRSA_SIA_URL,
            params={"COLLECTION": "spherex_qr2", "POS": "circle 0 0 0.0001", "MAXREC": 0},
        )
        response.raise_for_status()
        found = parse_collections(response.text)
    except httpx.HTTPError as error:
        log.warning("Release discovery failed: %s", error)
        found = ()
    if found:
        _write_atomic(path, json.dumps(found).encode())
        return found
    return tuple(json.loads(path.read_text())) if path.exists() else config.FALLBACK_COLLECTIONS


def search(client: httpx.Client, ra: float, dec: float) -> list[Exposure]:
    """List every exposure covering a position, across all known releases."""
    path = config.CACHE_DIR / "search" / f"{ra:.4f}_{dec:.4f}.json"
    if _is_fresh(path):
        return _read_search(path)
    try:
        found = _query_all_releases(client, ra, dec)
    except httpx.HTTPError as error:
        if path.exists():
            log.warning("Search failed, using stale result: %s", error)
            return _read_search(path)
        raise
    _write_atomic(path, json.dumps([asdict(item) for item in found]).encode())
    return found


def _query_all_releases(client: httpx.Client, ra: float, dec: float) -> list[Exposure]:
    rows: list[Exposure] = []
    for collection in discover_collections(client):
        response = client.get(
            config.IRSA_SIA_URL,
            params={
                "COLLECTION": collection,
                "POS": f"circle {ra} {dec} 0.001",
                "RESPONSEFORMAT": "CSV",
            },
        )
        response.raise_for_status()
        rows.extend(parse_sia_csv(response.text))
    return sorted(dedupe_latest(rows), key=lambda item: item.mjd)


def _read_search(path: Path) -> list[Exposure]:
    return [Exposure(**item) for item in json.loads(path.read_text())]


def fetch_cutout(
    client: httpx.Client, exposure: Exposure, ra: float, dec: float, size_deg: float
) -> bytes:
    """Download one cutout as FITS bytes."""
    return _download(client, cutout_url(exposure, ra, dec, size_deg))


def _download(client: httpx.Client, url: str) -> bytes:
    """Fetch with retries, honouring the archive's Retry-After when it is busy."""
    for attempt in range(config.CUTOUT_RETRIES):
        response = None
        try:
            response = client.get(url)
            response.raise_for_status()
            return response.content
        except httpx.HTTPError as error:
            log.info("Cutout attempt %d failed for %s: %s", attempt + 1, url, error)
            if attempt + 1 == config.CUTOUT_RETRIES:
                raise
            time.sleep(_retry_delay(response, attempt))
    raise RuntimeError("unreachable")


def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
    wait = response.headers.get("retry-after", "") if response is not None else ""
    jitter = random.uniform(0, 2)
    return (float(wait) if wait.isdigit() else 2**attempt) + jitter


def _is_fresh(path: Path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < config.SEARCH_TTL_SECONDS


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    temporary.write_bytes(payload)
    temporary.replace(path)
