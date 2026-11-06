"""Copies the low-resolution all-sky AllWISE tiles into the site, so the map never depends on a server.

Usage: python -m scripts.sky_tiles [output-directory]
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

BASE_URL = "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1/"
MAX_ORDER = 3
BASE_PIXELS = 12
WORKERS = 6
OUTPUT = Path(sys.argv[1] if len(sys.argv) > 1 else "static/data/sky")


def tile_paths() -> list[str]:
    paths = ["Norder3/Allsky.jpg"]
    for order in range(MAX_ORDER + 1):
        for pixel in range(BASE_PIXELS * 4**order):
            paths.append(f"Norder{order}/Dir{pixel // 10000 * 10000}/Npix{pixel}.jpg")
    return paths


def fetch(client: httpx.Client, path: str) -> None:
    target = OUTPUT / path
    if target.exists():
        return
    response = client.get(BASE_URL + path)
    if response.status_code == 404:
        return
    response.raise_for_status()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)


def main() -> None:
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        properties = client.get(BASE_URL + "properties").text
        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(lambda path: fetch(client, path), tile_paths()))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    limited = re.sub(r"^hips_order\s*=.*$", f"hips_order = {MAX_ORDER}", properties, flags=re.M)
    (OUTPUT / "properties").write_text(limited)
    print(sum(path.stat().st_size for path in OUTPUT.rglob("*") if path.is_file()) // 2**20, "MiB", flush=True)


if __name__ == "__main__":
    main()
