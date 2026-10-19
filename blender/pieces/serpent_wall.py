"""Coatepantli: the wall of serpents round the sacred precinct. A segment two
units long along X, flush at both ends so segments tile; a greca on both
faces and three serpent heads looking out of the front (-Y) face. No
chipped edges: the ends must meet flush and the coping stays clean."""
from kit import box, meander, prism, rbox, relief

STONES = ["basalt", "cantera"]
RES = 1024
TRIS = 6500
L = 2.0
HEADS = (-2 / 3, 0.0, 2 / 3)  # same spacing across the joints when segments tile


def band(units, cell, z, y, outward):
    """A greca band running along X on the face at y."""
    span = units * 8 * cell
    x0 = -span / 2 if outward < 0 else span / 2
    return relief(meander(units), cell, 0.005, (x0, y, z - 3.5 * cell), (-outward, 0, 0), (0, 0, 1), (0, outward, 0))


def head(x):
    """A serpent head jutting from the wall: skull and upper jaw, an open mouth
    with fangs, the lower jaw, heavy brows over the eyes, nostrils."""
    solids = [rbox(x - 0.075, x + 0.075, -0.30, -0.09, 0.17, 0.28, 0.03),       # skull, upper jaw
              rbox(x - 0.065, x + 0.065, -0.27, -0.09, 0.08, 0.135, 0.022)]     # lower jaw
    cutters = []
    for s in (-1, 1):
        ex = x + s * 0.045
        solids.append(rbox(ex - 0.026, ex + 0.026, -0.24, -0.15, 0.255, 0.305, 0.012))  # brow
        cutters.append(box(ex - 0.012, ex + 0.012, -0.26, -0.225, 0.265, 0.285))     # eye
        solids.append(box(x + s * 0.048 - 0.01, x + s * 0.048 + 0.01, -0.29, -0.265, 0.125, 0.172))  # fang
        cutters.append(box(x + s * 0.025 - 0.008, x + s * 0.025 + 0.008, -0.315, -0.29, 0.235, 0.25))  # nostril
    return solids, cutters


def build(seed=7):
    t = 0.1
    solids = [prism([(-t, 0.0), (t, 0.0), (t, 0.29), (-t, 0.29)], -L / 2, L / 2, chip=False),
              prism([(-t - 0.018, 0.29), (t + 0.018, 0.29), (t + 0.018, 0.325), (-t - 0.018, 0.325)], -L / 2, L / 2),
              prism([(-t + 0.005, 0.325), (t - 0.005, 0.325), (t - 0.02, 0.35), (-t + 0.02, 0.35)], -L / 2, L / 2)]
    cell = 0.0115
    units = int((L - 0.02) / (cell * 8))
    cutters = [band(units, cell, 0.16, -t, -1), band(units, cell, 0.16, t, 1)]
    for x in HEADS:
        s, c = head(x)
        solids += s
        cutters += c
    return solids, cutters
