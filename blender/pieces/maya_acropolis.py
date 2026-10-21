"""A great Maya acropolis, after Structure II at Calakmul: a broad, massive
base of four terraces, a wide stairway up the middle of the front, and on the
summit platform a temple with a roof comb between two long palace buildings.
A ruin, like the others. Front is -Y.

    npm run piece -- maya_acropolis
"""
import random
import maya
from kit import box

STONES = ["limestone"]
RES = 1024
TRIS = 9000
SEEDS = [5]
PROTECT = [((-0.21, 0.21), (-0.5, -0.2), (0.0, 0.4))]


def palace(x, y, z, length, rng):
    """A long, low building with three doorways and a flat roof over a moulding."""
    solids, cutters = [], []
    w, d, h = length, 0.12, 0.075
    solids.append(box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + h, chip=True))
    for k in (-1, 0, 1):
        dx = x + k * w * 0.3
        cutters.append(box(dx - 0.017, dx + 0.017, y - d / 2 - 0.02, y - d / 2 + 0.05, z, z + 0.05))
    solids.append(box(x - w / 2 - 0.008, x + w / 2 + 0.008, y - d / 2 - 0.008, y + d / 2 + 0.008, z + h, z + h + 0.012, chip=True))
    solids.append(box(x - w / 2 + 0.01, x + w / 2 - 0.01, y - d / 2 + 0.01, y + d / 2 - 0.01, z + h + 0.012, z + h + 0.032, chip=True))
    # Half its roof has come down.
    side = rng.choice((-1, 1))
    cutters.append(maya.wedge(x + side * w * 0.35, y, z + h + 0.03, 0.12, 0.2, rng.uniform(-0.3, 0.3), 0.02))
    return solids, cutters


def build(seed=7):
    rng = random.Random(seed)
    tiers = [(1.0 - i * 0.1, 0.74 - i * 0.07, 0.088) for i in range(4)]
    solids, cutters, top, spans = maya.terraces(tiers)
    d_top = tiers[-1][1]
    width, y0, y1 = 0.36, -tiers[0][1] / 2 - 0.06, -d_top / 2 + 0.01
    solids += maya.stairway(width, y0, y1, top, steps=22)
    s, c, comb_top = maya.temple(top, w=0.3, d=0.2, y=0.03, doors=3, comb=1.0, s=0.95)
    solids += s
    cutters += c
    for x in (-0.25, 0.25):
        s, c = palace(x, -0.05, top, 0.17, rng)
        solids += s
        cutters += c
    cutters += maya.ruin(rng, spans, (width, y0, y1, top), comb_top)
    return solids, cutters
