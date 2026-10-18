"""A ceremonial brazier (tlecuilli on a column): stepped base, banded shaft,
a flared bowl studded with knobs, coals heaped inside. Fire is added live."""
import math, random
from kit import box, cylinder, frustum, rbox

STONES = ["basalt"]
RES = 2048
TRIS = 12000
PROTECT = [((-1, 1), (-1, 1), (0.55, 2))]  # no chips on the bowl's round rims


def build(seed=7):
    rng = random.Random(seed)
    solids = [frustum(0.62, 0.62, 0.62, 0.62, 0.0, 0.08),
              frustum(0.50, 0.50, 0.46, 0.46, 0.08, 0.16),
              cylinder(0.15, 0.16, 0.56, r1=0.13, chip=False),
              cylinder(0.17, 0.22, 0.25), cylinder(0.155, 0.50, 0.53),       # shaft bands
              cylinder(0.19, 0.55, 0.60, r1=0.21),                         # capital
              cylinder(0.21, 0.60, 0.86, r1=0.34),                         # bowl
              cylinder(0.355, 0.84, 0.88)]                                  # rim
    for k in range(8):                                                      # knobs
        a = math.tau * k / 8
        r, z = 0.29, 0.75
        x, y = r * math.cos(a), r * math.sin(a)
        solids.append(rbox(x - 0.03, x + 0.03, y - 0.03, y + 0.03, z - 0.03, z + 0.03, 0.02))
    cutters = [cylinder(0.31, 0.72, 0.95)]                                  # hollow
    for _ in range(26):                                                     # coals
        a, r = rng.uniform(0, math.tau), rng.uniform(0, 0.24)
        x, y, s = r * math.cos(a), r * math.sin(a), rng.uniform(0.03, 0.06)
        solids.append(rbox(x - s, x + s, y - s, y + s, 0.72, 0.78 + rng.uniform(0, 0.04), s * 0.6))
    return solids, cutters
