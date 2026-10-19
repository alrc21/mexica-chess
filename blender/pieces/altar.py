"""Momoxtli: a low square altar platform with a stair on every side, a greca
round its walls, and a small carved stone of the sun (Ollin) on top."""
from kit import box, frustum, ollin, disc_field, plinth, relief

STONES = ["cantera", "tezontle"]
RES = 1024
TRIS = 5000
PROTECT = [((-0.13, 0.13), (-0.52, 0.52), (0.0, 0.21)), ((-0.52, 0.52), (-0.13, 0.13), (0.0, 0.21))]


def build(seed=7):
    solids, cutters = plinth(size=0.72, h=0.2)  # walls with the greca band at mid-height
    solids.append(frustum(0.765, 0.765, 0.765, 0.765, 0.2, 0.226))  # cornice
    steps, rise, run = 5, 0.2 / 5, 0.14 / 5
    for i in range(steps):
        a, b, zz = -0.5 + i * run, -0.3, (i + 1) * rise
        solids += [box(-0.11, 0.11, a, b, 0, zz), box(-0.11, 0.11, -b, -a, 0, zz),
                   box(a, b, -0.11, 0.11, 0, zz), box(-b, -a, -0.11, 0.11, 0, zz)]
    solids.append(box(-0.12, 0.12, -0.12, 0.12, 0.226, 0.262, chip=True))
    n = 14
    cutters.append(relief(disc_field(n) - ollin(n), 0.115 / n, 0.004, (0, 0, 0.262), (1, 0, 0), (0, 1, 0), (0, 0, 1)))
    return solids, cutters
