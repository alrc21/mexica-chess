"""Macehualli — the pawn. A foot soldier in a quilted cotton cap, holding
the round chimalli shield with its fringe of feathers. Front is -Y."""
from kit import cylinder, disc_field, face, frustum, on_front, plinth, rbox

TRIS = 10000


def build(seed=7):
    solids, cutters = plinth(0.64, 0.075)
    solids += [frustum(0.44, 0.36, 0.41, 0.34, 0.075, 0.22, chip="sides"),
               frustum(0.46, 0.38, 0.46, 0.38, 0.208, 0.222),                # belt
               frustum(0.40, 0.33, 0.37, 0.31, 0.222, 0.40, chip="sides"),
               rbox(-0.19, 0.19, -0.165, 0.165, 0.385, 0.415, 0.01),         # collar
               rbox(-0.125, 0.125, -0.12, 0.12, 0.41, 0.56, 0.03),           # head
               rbox(-0.135, 0.135, -0.13, 0.13, 0.52, 0.585, 0.03)]          # cotton cap
    f_solids, f_cut = face(0, 0.49, -0.12, 0.25)
    solids += f_solids
    cutters += f_cut
    r, z = 0.135, 0.265                                                      # chimalli
    solids.append(cylinder(r, -0.215, -0.18, axis="y", at=(0.0, z)))
    for x in (-0.08, -0.04, 0.0, 0.04, 0.08):                                # feather fringe
        solids.append(rbox(x - 0.015, x + 0.015, -0.212, -0.188, z - r - 0.045, z - r + 0.012, 0.007))
    n = 14
    ring = disc_field(n, 3) - disc_field(n, 5)
    bar = {(i, j) for i, j in disc_field(n, 5) if -2 <= j < 1}
    cutters.append(on_front(ring | bar, r / n, 0.005, 0, z, -0.215))
    return solids, cutters
