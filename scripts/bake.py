"""Download the challenge's five test targets ahead of a demo.

Usage: python -m scripts.bake [preset-key ...]
"""
import sys
import time

from backend import wise
from backend.jobs import Job
from backend.presets import ALL_TARGETS



def bake(preset) -> None:
    ra, dec = preset.centre()
    job = Job(ra, dec, preset.fov, limit=preset.limit)
    started = time.time()
    job.run()
    wise.frame(job.grid)
    print(
        f"{preset.key}: {len(job.frames)}/{job.total} frames of {job.available} available, "
        f"{job.failed} failed, {time.time() - started:.0f}s, status={job.status} {job.error or ''}",
        flush=True,
    )


if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    for preset in sorted(ALL_TARGETS, key=lambda item: item.key != "wise0855"):
        if not wanted or preset.key in wanted:
            bake(preset)
