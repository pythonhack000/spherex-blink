"""Writes the target list for the static site.

Usage: python -m scripts.write_targets [output-directory]
"""
import json
import sys
from pathlib import Path

from backend.presets import ALL_TARGETS

output = Path(sys.argv[1] if len(sys.argv) > 1 else "static/data")
output.mkdir(parents=True, exist_ok=True)
(output / "targets.json").write_text(json.dumps([preset.to_json() for preset in ALL_TARGETS]))
