"""Cuauhtli — the bishop. The eagle warrior: his face looks out from the
open beak of the eagle helmet, a crest of feathers swept back, feathers
layered down his chest. Front is -Y."""
from kit import chevrons, disc_field, face, frustum, plinth, prism, rbox, relief, _r

TRIS = 17000


def build(seed=7):
    solids, cutters = plinth()
    solids += [frustum(0.52, 0.42, 0.48, 0.40, 0.085, 0.32, chip="sides"),
               frustum(0.54, 0.44, 0.54, 0.44, 0.305, 0.32),
               frustum(0.46, 0.38, 0.42, 0.36, 0.32, 0.60, chip="sides"),
               rbox(-0.23, 0.23, -0.20, 0.20, 0.585, 0.625, 0.012),
               rbox(-0.15, 0.15, -0.15, 0.15, 0.62, 0.79, 0.03),            # face block
               rbox(-0.17, 0.17, -0.17, 0.18, 0.77, 0.85, 0.035)]           # helmet hood
    f_solids, f_cut = face(0, 0.715, -0.15, 0.28)
    solids += f_solids
    cutters += f_cut
    solids.append(prism([(-0.15, 0.85), (-0.27, 0.82), (-0.32, 0.75), (-0.29, 0.722), (-0.15, 0.79)],
                        -0.10, 0.10, chip=True))                            # upper beak, hooked
    solids.append(prism([(-0.15, 0.635), (-0.235, 0.645), (-0.225, 0.615), (-0.15, 0.60)], -0.09, 0.09))  # lower beak
    for x, h in ((-0.10, 0.0), (-0.05, 0.03), (0.0, 0.05), (0.05, 0.03), (0.10, 0.0)):  # crest
        solids.append(prism([(0.0, 0.83), (0.10, 0.83), (0.27, 0.93 + h), (0.18, 0.93 + h)], x - 0.019, x + 0.019))
    ring = {c for c in disc_field(8, 0) if _r(*c) > 4.5}                    # eagle eyes on the hood
    for side in (-1, 1):
        cutters.append(relief(ring, 0.0045, 0.004, (0.17 * side, -0.06, 0.81),
                              (0, -side, 0), (0, 0, 1), (side, 0, 0)))
    cell = 0.0105
    cutters.append(relief(chevrons(15, 24), cell, 0.005, (0, -0.19, 0.345), (1, 0, 0), (0, 0, 1), (0, -1, 0)))
    cutters.append(relief(chevrons(15, 24), cell, 0.005, (0, 0.19, 0.345), (-1, 0, 0), (0, 0, 1), (0, 1, 0)))
    cutters.append(relief(chevrons(18, 10, 4), 0.009, 0.004, (0, 0.20, 0.10), (-1, 0, 0), (0, 0, 1), (0, 1, 0)))  # tail feathers
    return solids, cutters
