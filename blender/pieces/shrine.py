"""Precinct shrine: a small temple of the sacred precinct. Four talud tiers,
one stairway with serpent balustrades, a single shrine on the summit with a
doorway and a carved lintel. Front is -Y."""
from kit import box, frustum, meander, plinth, prism, relief

STONES = ["cantera", "tezontle"]
RES = 1024
TRIS = 7000
PROTECT = [((-0.14, 0.14), (-0.52, -0.17), (0.05, 0.55))]  # the stairway stays crisp

TIERS = [(0.84, 0.78, 0.13), (0.70, 0.64, 0.12), (0.56, 0.50, 0.11), (0.42, 0.38, 0.10)]


def build(seed=7):
    solids, cutters = plinth(size=1.0, h=0.06)
    z = 0.06
    for w0, w1, h in TIERS:
        solids.append(frustum(w0, w0, w1, w1, z, z + h))
        ledge = w1 + 0.016  # the moulding that caps every tier
        solids.append(frustum(ledge, ledge, ledge, ledge, z + h - 0.016, z + h))
        z += h
    top = z

    # One stairway up the front, steep as the Mexica built them.
    yb, yt, steps = -0.48, -0.19, 16
    rise, run = (top - 0.06) / steps, (yt - yb) / steps
    for i in range(steps):
        solids.append(box(-0.085, 0.085, yb + i * run, yt + 0.03, 0.06, 0.06 + (i + 1) * rise))
    for cx in (-0.1, 0.1):  # balustrades ending in serpent heads
        w = 0.03
        solids.append(prism([(yb - 0.012, 0.06), (yt + 0.05, top - 0.02), (yt, top + 0.035), (yb - 0.012, 0.115)],
                            cx - w / 2, cx + w / 2))
        solids.append(box(cx - w / 2 - 0.007, cx + w / 2 + 0.007, yb - 0.05, yb + 0.012, 0.06, 0.12, chip=True))

    # The shrine: walls, cornice, a stepped roof with merlons.
    solids.append(box(-0.13, 0.13, -0.12, 0.15, top, top + 0.185, chip=True))
    solids.append(box(-0.145, 0.145, -0.135, 0.165, top + 0.185, top + 0.21, chip=True))
    solids.append(box(-0.11, 0.11, -0.1, 0.13, top + 0.21, top + 0.25, chip=True))
    for dx in (-0.075, -0.025, 0.025, 0.075):
        solids.append(box(dx - 0.014, dx + 0.014, -0.01, 0.04, top + 0.25, top + 0.29))
    cutters.append(box(-0.045, 0.045, -0.16, -0.06, top - 0.005, top + 0.115))  # doorway
    cell, units = 0.0068, 4  # a greca across the lintel
    span = units * 8 * cell
    cutters.append(relief(meander(units), cell, 0.004, (-span / 2, -0.12, top + 0.127), (1, 0, 0), (0, 0, 1), (0, -1, 0)))
    return solids, cutters
