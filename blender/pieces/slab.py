"""A paving slab of the board. Three variants, each baked in pale cantera
(light squares) and grey andesite (dark squares); the board deals them out
with random turns so no two neighbours match."""
import math, random
from kit import box, prism

STONES = ["cantera", "andesite"]
SEEDS = [3, 11, 19]
RES = 1024
TRIS = 2400
S, H = 0.986, 0.06  # 1.0 tiles, 14 mm of mortar


def crack(rng):
    """A hairline crack wandering in from one edge."""
    x, y = -S / 2, rng.uniform(-0.3, 0.3)
    a = rng.uniform(-0.5, 0.5)
    out = []
    for _ in range(rng.randint(5, 9)):
        a += rng.uniform(-0.6, 0.6)
        L = rng.uniform(0.04, 0.09)
        nx, ny = x + L * math.cos(a), y + L * math.sin(a)
        w = 0.0025
        px, py = -math.sin(a) * w, math.cos(a) * w
        out.append(prism([(x - px, y - py), (nx - px, ny - py), (nx + px, ny + py), (x + px, y + py)],
                         H - 0.012, H + 0.01, axis="z"))
        x, y = nx, ny
    return out


def build(seed=7):
    rng = random.Random(seed)
    solids = [box(-S / 2, S / 2, -S / 2, S / 2, 0, H, chip=True)]
    cutters = crack(rng) if seed != SEEDS[0] else []
    return solids, cutters
