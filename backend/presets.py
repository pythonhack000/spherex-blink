"""The five test targets named in the challenge statement."""
from dataclasses import asdict, dataclass

from .coords import propagate

MID_BASELINE_MJD = 61100.0  # early 2026, the middle of the SPHEREx data so far
DEFAULT_FOV_DEG = 0.1
PLACE_FRAMES = 90


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
    category: str = "challenge"
    ru: str = ""
    limit: int = 150

    def centre(self) -> tuple[float, float]:
        return propagate(self.ra, self.dec, self.pmra, self.pmdec, self.epoch, MID_BASELINE_MJD)

    def to_json(self) -> dict:
        centre_ra, centre_dec = self.centre()
        return {**asdict(self), "centreRa": centre_ra, "centreDec": centre_dec}


PRESETS = (
    Preset(
        "barnard", "Barnard's Star", 269.44875, 4.73942, -801.55, 10362.39, 2016.0,
        "faststar", ("barnard", "barnards star", "barnard's star", "gj 699", "звезда барнарда", "барнарда"),
        ru="Звезда Барнарда",
    ),
    Preset(
        "wise0855", "WISE 0855", 133.79513, -7.24515, -8118.0, 673.0, 2010.5,
        "browndwarf", ("wise 0855", "wise0855", "w0855", "wise j085510.83-071442.5", "висе 0855"),
    ),
    Preset(
        "epsindib", "Epsilon Indi B", 331.04380, -56.78269, 3961.4, -2538.3, 2000.0,
        "browndwarf", ("eps ind b", "epsilon indi b", "eps indi b", "epsilon indi ba", "эпсилон индейца b"),
        ru="Эпсилон Индейца B",
    ),
    Preset(
        "rwaur", "RW Aurigae", 76.95644, 30.40141, 3.6, -25.7, 2000.0,
        "variable", ("rw aur", "rw aurigae", "rw возничего"),
        ru="RW Возничего",
    ),
    Preset(
        "rdra", "R Draconis", 248.16733, 66.75497, -5.7, 21.6, 2000.0,
        "variable", ("r dra", "r draconis", "r дракона"),
        ru="R Дракона",
    ),
)


def _place(key, name, ru, ra, dec, kind, category, fov, aliases=(), pmra=0.0, pmdec=0.0):
    return Preset(
        key, name, ra, dec, pmra, pmdec, 2000.0, kind, (key, *aliases), fov, category, ru, PLACE_FRAMES
    )


PLACES = (
    _place("kapteyn", "Kapteyn's Star", "Звезда Каптейна", 77.91904, -45.01843, "faststar", "stars", 0.1,
           ("kapteyn", "каптейна"), 6505.0, -5731.0),
    _place("groombridge", "Groombridge 1830", "Грумбридж 1830", 178.22725, 37.71868, "faststar", "stars", 0.1,
           ("грумбридж",), 4003.0, -5813.0),
    _place("lacaille", "Lacaille 9352", "Лакайль 9352", 346.46653, -35.85325, "faststar", "stars", 0.1,
           ("лакайль",), 6767.0, 1327.0),
    _place("61cyg", "61 Cygni", "61 Лебедя", 316.72475, 38.74942, "faststar", "stars", 0.1,
           ("61 cyg", "61 лебедя"), 4168.0, 3269.0),
    _place("proxima", "Proxima Centauri", "Проксима Центавра", 217.42895, -62.67949, "faststar", "stars", 0.1,
           ("proxima", "проксима"), -3775.8, 765.5),
    _place("sirius", "Sirius", "Сириус", 101.28716, -16.71612, "faststar", "stars", 0.1,
           ("сириус",), -546.0, -1223.1),
    _place("m31", "Andromeda Galaxy", "Галактика Андромеды", 10.68471, 41.26875, "galaxy", "galaxies", 0.5,
           ("m 31", "andromeda", "андромеда", "туманность андромеды")),
    _place("m51", "Whirlpool Galaxy", "Галактика Водоворот", 202.46958, 47.19526, "galaxy", "galaxies", 0.25,
           ("m 51", "whirlpool", "водоворот")),
    _place("m101", "Pinwheel Galaxy", "Галактика Вертушка", 210.80243, 54.34875, "galaxy", "galaxies", 0.5,
           ("m 101", "pinwheel", "вертушка")),
    _place("m104", "Sombrero Galaxy", "Галактика Сомбреро", 189.99763, -11.62305, "galaxy", "galaxies", 0.25,
           ("m 104", "sombrero", "сомбреро")),
    _place("m42", "Orion Nebula", "Туманность Ориона", 83.82208, -5.39111, "nebula", "nebulae", 0.5,
           ("m 42", "orion", "орион")),
    _place("m16", "Eagle Nebula", "Туманность Орёл", 274.70000, -13.80700, "nebula", "nebulae", 0.25,
           ("m 16", "pillars of creation", "столпы творения", "орел")),
    _place("m8", "Lagoon Nebula", "Туманность Лагуна", 270.90417, -24.38667, "nebula", "nebulae", 0.5,
           ("m 8", "lagoon", "лагуна")),
    _place("helix", "Helix Nebula", "Туманность Улитка", 337.41042, -20.83722, "nebula", "nebulae", 0.5,
           ("ngc 7293", "улитка")),
    _place("m45", "Pleiades", "Плеяды", 56.75000, 24.11667, "cluster", "clusters", 0.5,
           ("m 45", "плеяды")),
    _place("m13", "Hercules Cluster", "Скопление Геркулеса", 250.42183, 36.46131, "cluster", "clusters", 0.25,
           ("m 13", "геркулес")),
    _place("omegacen", "Omega Centauri", "Омега Центавра", 201.69683, -47.47947, "cluster", "clusters", 0.5,
           ("omega cen", "омега центавра")),
)
ALL_TARGETS = (*PRESETS, *PLACES)


def find_preset(query: str) -> Preset | None:
    wanted = " ".join(query.lower().split())
    return next((preset for preset in ALL_TARGETS if wanted in preset.aliases), None)
