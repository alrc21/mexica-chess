"""A tall Maya temple of the Petén: seven steep terraces (six on the second
variant) with apron mouldings and inset corners, one stairway up the front,
and on the summit a three-door temple under a pierced roof comb. A ruin:
corners fallen, gaps in the stair, the comb broken. Front is -Y.

    npm run piece -- maya_temple   (two variants: maya_temple0, maya_temple1)
"""
import random
import maya

STONES = ["limestone"]
RES = 1024
TRIS = 9000
SEEDS = [3, 11]
PROTECT = [((-0.15, 0.15), (-0.6, -0.2), (0.0, 0.9))]  # chips off the tiers' edges must not bite the stair


def build(seed=7):
    rng = random.Random(seed)
    n = 7 if seed == 3 else 6
    tier_h = 0.105 if n == 7 else 0.118
    tiers = [(1.0 - i * 0.115, 0.92 - i * 0.105, tier_h) for i in range(n)]
    solids, cutters, top, spans = maya.terraces(tiers)
    d_top = tiers[-1][1]
    width, y0, y1 = 0.24, -tiers[0][1] / 2 - 0.07, -d_top / 2 + 0.01
    solids += maya.stairway(width, y0, y1, top, steps=34)
    s, c, comb_top = maya.temple(top, w=0.34, d=0.24, y=0.01, doors=3, comb=1.15 if n == 7 else 1.0)
    solids += s
    cutters += c
    cutters += maya.ruin(rng, spans, (width, y0, y1, top), comb_top)
    return solids, cutters
