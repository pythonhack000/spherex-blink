"""Processed frames on disk: small, fast to read, and shippable with the app."""
import io
import json
import logging
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config
from .archive import _write_atomic

log = logging.getLogger("blink.framestore")


@dataclass(frozen=True)
class Frame:
    meta: dict
    pixels: np.ndarray
    mask: np.ndarray


def path_for(job_id: str, key: str) -> Path:
    return config.CACHE_DIR / "frames" / job_id / f"{key}.npz"


def save(job_id: str, key: str, frame: Frame) -> None:
    output = io.BytesIO()
    np.savez_compressed(output, pixels=frame.pixels, mask=frame.mask, meta=json.dumps(frame.meta))
    _write_atomic(path_for(job_id, key), output.getvalue())


def load(job_id: str, key: str, visit: int) -> Frame | None:
    """Read a stored frame; a damaged file counts as missing so it is rebuilt."""
    path = path_for(job_id, key)
    if not path.exists():
        return None
    try:
        with np.load(path) as stored:
            meta = {**json.loads(str(stored["meta"])), "visit": visit}
            return Frame(meta, stored["pixels"], stored["mask"])
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        log.warning("Ignoring damaged frame %s: %s", path, error)
        return None
