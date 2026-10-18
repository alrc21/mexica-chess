"""Corner block of the board's border: a basalt cube carved with Ollin."""
from kit import box, disc_field, ollin, relief

STONES = ["basalt"]
RES = 1024
TRIS = 4000


def build(seed=7):
    solids = [box(-0.30, 0.25, -0.30, 0.25, 0.0, 0.13, chip=True)]
    n = 16
    cutters = [relief(disc_field(n) - ollin(n), 0.2 / n, 0.005, (-0.025, -0.025, 0.13), (1, 0, 0), (0, 1, 0), (0, 0, 1))]
    return solids, cutters
