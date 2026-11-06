"""The five test targets named in the challenge statement."""
from dataclasses import asdict, dataclass

from .coords import propagate

MID_BASELINE_MJD = 61100.0  # early 2026, the middle of the SPHEREx data so far
DEFAULT_FOV_DEG = 0.1


@dataclass(frozen=True)
class Preset:
    key: str
    name: str
    ra: float
    dec: float
    pmra: float  # mas/yr, includes cos dec
    pmdec: float  # mas/yr
    epoch: float
    kind: str
    aliases: tuple[str, ...] = ()
    fov: float = DEFAULT_FOV_DEG

    def centre(self) -> tuple[float, float]:
        return propagate(self.ra, self.dec, self.pmra, self.pmdec, self.epoch, MID_BASELINE_MJD)

    def to_json(self) -> dict:
        centre_ra, centre_dec = self.centre()
        return {**asdict(self), "centreRa": centre_ra, "centreDec": centre_dec}


PRESETS = (
    Preset(
        "barnard", "Barnard's Star", 269.44875, 4.73942, -801.55, 10362.39, 2016.0,
        "star", ("barnard", "barnards star", "barnard's star", "gj 699"),
    ),
    Preset(
        "wise0855", "WISE 0855", 133.79513, -7.24515, -8118.0, 673.0, 2010.5,
        "browndwarf", ("wise 0855", "wise0855", "w0855", "wise j085510.83-071442.5"),
    ),
    Preset(
        "epsindib", "Epsilon Indi B", 331.04380, -56.78269, 3961.4, -2538.3, 2000.0,
        "browndwarf", ("eps ind b", "epsilon indi b", "eps indi b", "epsilon indi ba"),
    ),
    Preset(
        "rwaur", "RW Aurigae", 76.95644, 30.40141, 3.6, -25.7, 2000.0,
        "variable", ("rw aur", "rw aurigae"),
    ),
    Preset(
        "rdra", "R Draconis", 248.16733, 66.75497, -5.7, 21.6, 2000.0,
        "variable", ("r dra", "r draconis"),
    ),
)


def find_preset(query: str) -> Preset | None:
    wanted = " ".join(query.lower().split())
    return next((preset for preset in PRESETS if wanted in preset.aliases), None)
