"""Background jobs that collect exposures for one sky patch, frame by frame."""
import hashlib
import logging
import random
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import numpy as np

from . import archive, config, framestore
from .archive import Exposure
from .coords import mjd_to_year
from .framestore import Frame
from .processing import (
    Grid,
    channel_index,
    group_visits,
    load_native,
    reproject,
    wavelength_at,
    wavelength_gradient,
)

log = logging.getLogger("blink.jobs")
MIN_COVERED_FRACTION = 0.05
_download_pool = ThreadPoolExecutor(config.DOWNLOAD_WORKERS, thread_name_prefix="cutout")


class Job:
    def __init__(self, ra: float, dec: float, fov: float, limit: int = config.MAX_EXPOSURES):
        self.id = job_id(ra, dec, fov)
        self.grid = Grid.for_fov(ra, dec, fov)
        self.limit = limit
        self.status = "searching"
        self.error: str | None = None
        self.available = 0
        self.total = 0
        self.failed = 0
        self.frames: list[Frame] = []
        self._lock = threading.Lock()

    def frames_from(self, start: int) -> list[Frame]:
        with self._lock:
            return self.frames[start:]

    def summary(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "error": self.error,
            "done": len(self.frames),
            "failed": self.failed,
            "total": self.total,
            "available": self.available,
            "ra": self.grid.ra,
            "dec": self.grid.dec,
            "fov": self.grid.fov,
            "n": self.grid.n,
            "scale": self.grid.scale,
        }

    def run(self) -> None:
        try:
            with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
                self._collect(client)
            self.status = "done"
        except Exception as error:
            log.exception("Job %s failed", self.id)
            self.error = f"The SPHEREx archive could not be reached: {error}"
            self.status = "error"

    def _collect(self, client: httpx.Client) -> None:
        exposures = archive.search(client, self.grid.ra, self.grid.dec)
        self.available = len(exposures)
        chosen = sample_evenly(exposures, self.limit)
        self.total = len(chosen)
        self.status = "downloading"
        visits = dict(zip(chosen, group_visits([item.mjd for item in chosen])))
        # A random order fills every date and band early, so a partial result is useful.
        order = random.Random(self.id).sample(chosen, len(chosen))
        pending = [_download_pool.submit(self._build, client, item, visits[item]) for item in order]
        for future in as_completed(pending):
            self._store(future)

    def _store(self, future) -> None:
        try:
            frame = future.result()
        except Exception as error:
            log.warning("Exposure skipped in job %s: %s", self.id, error)
            self.failed += 1
            return
        if frame is None:
            self.failed += 1
            return
        with self._lock:
            self.frames = [*self.frames, frame]

    def _build(self, client: httpx.Client, exposure: Exposure, visit: int) -> Frame | None:
        key = archive.exposure_key(exposure)
        stored = framestore.load(self.id, key, visit)
        if stored is not None:
            return stored
        size = self.grid.fov * config.CUTOUT_MARGIN
        payload = archive.fetch_cutout(client, exposure, self.grid.ra, self.grid.dec, size)
        frame = self._process(payload, exposure, visit)
        if frame is not None:
            framestore.save(self.id, key, frame)
        return frame

    def _process(self, payload: bytes, exposure: Exposure, visit: int) -> Frame | None:
        native = load_native(payload)
        pixels, mask = reproject(native, self.grid)
        covered = np.isfinite(pixels)
        if covered.mean() < MIN_COVERED_FRACTION:
            return None
        wavelength = wavelength_at(native, self.grid.ra, self.grid.dec) or (
            (exposure.wave_min_um + exposure.wave_max_um) / 2
        )
        wave_dx, wave_dy = wavelength_gradient(native, self.grid)
        meta = {
            "obsId": exposure.obs_id,
            "detector": exposure.detector,
            "mjd": exposure.mjd,
            "year": mjd_to_year(exposure.mjd),
            "visit": visit,
            "wavelength": wavelength,
            "waveDx": wave_dx,
            "waveDy": wave_dy,
            "channel": channel_index(wavelength, exposure.detector),
            "release": exposure.collection,
            "flaggedPct": round(float(mask[covered].mean() * 100), 2),
        }
        return Frame(meta, pixels, mask)


def job_id(ra: float, dec: float, fov: float) -> str:
    return hashlib.sha1(f"{ra:.4f}|{dec:.4f}|{fov:.3f}".encode()).hexdigest()[:12]


def sample_evenly(exposures: list[Exposure], limit: int) -> list[Exposure]:
    """Thin a long list evenly in time within each array, so every colour stays covered."""
    if len(exposures) <= limit:
        return exposures
    arrays = sorted({item.detector for item in exposures})
    chosen: list[Exposure] = []
    for position, detector in enumerate(arrays):
        members = [item for item in exposures if item.detector == detector]
        share = (limit - len(chosen)) // (len(arrays) - position)
        keep = np.linspace(0, len(members) - 1, min(share, len(members))).astype(int)
        chosen.extend(members[index] for index in keep)
    return sorted(chosen, key=lambda item: item.mjd)


class JobStore:
    """Recently used jobs; a rerun after eviction rebuilds from the disk cache."""

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, identifier: str) -> Job | None:
        with self._lock:
            return self._jobs.get(identifier)

    def start(self, ra: float, dec: float, fov: float) -> Job:
        identifier = job_id(ra, dec, fov)
        with self._lock:
            existing = self._jobs.get(identifier)
            if existing and existing.status != "error":
                self._jobs.move_to_end(identifier)
                return existing
            job = Job(ra, dec, fov)
            self._jobs[identifier] = job
            while len(self._jobs) > config.MAX_JOBS_IN_MEMORY:
                self._jobs.popitem(last=False)
        threading.Thread(target=job.run, daemon=True, name=f"job-{identifier}").start()
        return job
