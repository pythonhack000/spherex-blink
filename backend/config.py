"""Tunable constants, overridable through the environment."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(os.environ.get("BLINK_CACHE", ROOT / "cache"))
STATIC_DIR = ROOT / "static"

IRSA_SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/A"
VIZIER_URL = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"

# Used only if the archive's self-description cannot be read.
FALLBACK_COLLECTIONS = ("spherex_qr2", "spherex_qr3")

DOWNLOAD_WORKERS = int(os.environ.get("BLINK_WORKERS", 6))
MAX_EXPOSURES = int(os.environ.get("BLINK_MAX_EXPOSURES", 150))
MAX_JOBS_IN_MEMORY = int(os.environ.get("BLINK_MAX_JOBS", 4))
SEARCH_TTL_SECONDS = 24 * 3600
HTTP_TIMEOUT_SECONDS = 180
CUTOUT_RETRIES = 8

# A square cutout is rotated relative to the north-up plate, so request more
# than the field of view to keep the corners filled.
CUTOUT_MARGIN = 1.45
MIN_FOV_DEG = 0.02
MAX_FOV_DEG = 0.5
