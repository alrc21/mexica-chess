"""The board's border: basalt kerb segments two squares long, a running
greca along the top. Laid along X; -Y is outward, +Y meets the board."""
from kit import meander, prism, relief

STONES = ["basalt"]
RES = 2048
TRIS = 5000
L = 2.0


def build(seed=7):
    # Talud outside, a lip rising above the slabs (slab top = 0.06).
    profile = [(-0.30, 0.0), (0.25, 0.0), (0.25, 0.11), (-0.22, 0.11), (-0.27, 0.06)]
    solids = [prism(profile, -L / 2, L / 2, chip="long")]
    cell, units = 0.0115, int(L / (0.0115 * 8))
    span = units * 8 * cell
    cutters = [relief(meander(units), cell, 0.005, (-span / 2, -0.065, 0.11), (1, 0, 0), (0, 1, 0), (0, 0, 1))]
    return solids, cutters
