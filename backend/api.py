"""HTTP interface: search, frames, spectra, motion, and the static site."""
import json
import logging
import struct

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from . import analysis, config, gaia, hips, resolver, wise
from .coords import parse_position
from .jobs import Job, JobStore
from .presets import PRESETS

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="SPHEREx Blink")
app.add_middleware(GZipMiddleware, minimum_size=2048, compresslevel=4)
store = JobStore()

Ra = Query(ge=0, le=360)
Dec = Query(ge=-90, le=90)
Fov = Query(0.1, ge=config.MIN_FOV_DEG, le=config.MAX_FOV_DEG)
JSON_ALIGNMENT = 4


def _job_or_404(identifier: str) -> Job:
    job = store.get(identifier)
    if job is None:
        raise HTTPException(404, "This view has expired. Open the sky patch again.")
    return job


def _binary(meta, chunks: list[bytes]) -> Response:
    header = json.dumps(meta).encode()
    header += b" " * (-len(header) % JSON_ALIGNMENT)
    payload = b"".join([struct.pack("<I", len(header)), header, *chunks])
    return Response(payload, media_type="application/octet-stream")


@app.get("/api/presets")
def presets() -> list[dict]:
    return [preset.to_json() for preset in PRESETS]


@app.get("/api/parse")
def parse(text: str = Query(min_length=1, max_length=120)) -> dict:
    try:
        ra, dec = parse_position(text)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {"ra": ra, "dec": dec}


@app.get("/api/resolve")
def resolve(q: str = Query(min_length=1, max_length=80)) -> dict:
    try:
        found = resolver.resolve(q)
    except httpx.HTTPError as error:
        raise HTTPException(503, "The name service is unavailable. Enter coordinates instead.") from error
    if found is None:
        raise HTTPException(404, f"No object named {q!r} was found.")
    return found


@app.get("/api/observe")
def observe(ra: float = Ra, dec: float = Dec, fov: float = Fov) -> dict:
    return store.start(ra, dec, fov).summary()


@app.get("/api/job/{identifier}")
def job_status(identifier: str) -> dict:
    return _job_or_404(identifier).summary()


@app.get("/api/job/{identifier}/frames")
def job_frames(identifier: str, start: int = Query(0, ge=0)) -> Response:
    """Layout: uint32 JSON size, padded JSON, float32 pixels, uint8 masks (little-endian)."""
    frames = _job_or_404(identifier).frames_from(start)
    pixels = [frame.pixels.astype("<f4").tobytes() for frame in frames]
    masks = [frame.mask.astype(np.uint8).tobytes() for frame in frames]
    return _binary([frame.meta for frame in frames], [*pixels, *masks])


@app.get("/api/job/{identifier}/spectrum")
def job_spectrum(
    identifier: str,
    ra: float = Ra,
    dec: float = Dec,
    pmra: float = 0.0,
    pmdec: float = 0.0,
    epoch: float = 2016.0,
) -> list[dict]:
    return analysis.spectrum(_job_or_404(identifier), ra, dec, pmra, pmdec, epoch)


@app.get("/api/job/{identifier}/motion")
def job_motion(
    identifier: str,
    ra: float = Ra,
    dec: float = Dec,
    pmra: float = 0.0,
    pmdec: float = 0.0,
    epoch: float = 2016.0,
    detectors: str = Query("1,2,3,4,5,6", pattern=r"^[1-6](,[1-6])*$"),
) -> dict:
    chosen = {int(item) for item in detectors.split(",")}
    try:
        return analysis.measure_motion(_job_or_404(identifier), ra, dec, pmra, pmdec, epoch, chosen)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.get("/api/job/{identifier}/wise")
def job_wise(identifier: str) -> Response:
    """Layout: uint32 JSON size, padded JSON, float32 pixels (little-endian)."""
    job = _job_or_404(identifier)
    try:
        meta, pixels = wise.frame(job.grid)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(503, "The AllWISE archive is unavailable right now.") from error
    return _binary(meta, [pixels.astype("<f4").tobytes()])


@app.get("/hips/{path:path}")
def hips_tile(path: str) -> Response:
    if not hips.is_allowed(path):
        raise HTTPException(404, "Unknown sky tile")
    try:
        content = hips.tile(path)
    except httpx.HTTPError as error:
        raise HTTPException(503, "Sky tiles are unavailable right now.") from error
    if content is None:
        raise HTTPException(404, "No such sky tile")
    return Response(content, media_type=hips.media_type(path), headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/gaia")
def gaia_stars(ra: float = Ra, dec: float = Dec, fov: float = Fov) -> list[dict]:
    try:
        return gaia.nearby(ra, dec, fov)
    except httpx.HTTPError as error:
        raise HTTPException(503, "The Gaia catalogue is unavailable right now.") from error


app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
