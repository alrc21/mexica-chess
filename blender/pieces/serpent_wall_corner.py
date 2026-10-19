"""Corner pier of the coatepantli: a square pier a little taller than the
wall, the same greca on all four faces, a stepped cap. Wall segments
(thickness 0.2) butt against its faces."""
from kit import box, frustum, meander, relief

STONES = ["basalt", "cantera"]
RES = 1024
TRIS = 3000


def build(seed=7):
    s = 0.15
    solids = [frustum(2 * s, 2 * s, 2 * s, 2 * s, 0.0, 0.40, chip="sides"),
              frustum(2 * s + 0.03, 2 * s + 0.03, 2 * s + 0.03, 2 * s + 0.03, 0.40, 0.43, chip=False),
              frustum(0.25, 0.25, 0.19, 0.19, 0.43, 0.48, chip=False)]
    cell, units = 0.0115, 2
    span = units * 8 * cell
    cutters = []
    for u, n in (((1, 0, 0), (0, -1, 0)), ((0, 1, 0), (1, 0, 0)), ((-1, 0, 0), (0, 1, 0)), ((0, -1, 0), (-1, 0, 0))):
        origin = (-u[0] * span / 2 + n[0] * s, -u[1] * span / 2 + n[1] * s, 0.16 - 3.5 * cell)
        cutters.append(relief(meander(units), cell, 0.005, origin, u, (0, 0, 1), n))
    return solids, cutters
