"""Huey Tlatoani — the king. Moctezuma as a stele: a fan of quetzal plumes
behind the head, the pointed xiuhuitzolli diadem in front, ear spools, and
the speech scroll of "the one who speaks" carved on the chest. Front is -Y."""
import math
from kit import face, frustum, on_front, plinth, prism, rbox, spool, square_field, volute, _r

TRIS = 20000


def build(seed=7):
    solids, cutters = plinth()
    solids += [frustum(0.58, 0.46, 0.55, 0.44, 0.085, 0.30, chip="sides"),   # skirt
               frustum(0.60, 0.48, 0.60, 0.48, 0.288, 0.302),                # moulding
               frustum(0.52, 0.42, 0.48, 0.40, 0.30, 0.68, chip="sides"),    # torso
               rbox(-0.27, 0.27, -0.23, 0.23, 0.66, 0.705, 0.012),           # collar
               rbox(-0.18, 0.18, -0.17, 0.17, 0.70, 0.90, 0.035),            # head
               rbox(-0.19, 0.19, -0.18, 0.18, 0.86, 0.905, 0.01)]            # headband
    f_solids, f_cut = face(0, 0.80, -0.17, 0.36)
    solids += f_solids
    cutters += f_cut
    for x, side in ((-0.18, -1), (0.18, 1)):
        disc, hole = spool(x, 0.79, side)
        solids.append(disc)
        cutters.append(hole)
    solids.append(prism([(-0.15, 0.86), (0.15, 0.86), (0.15, 0.92), (0.0, 1.04), (-0.15, 0.92)],
                        -0.21, -0.175, axis="y", chip=True))               # xiuhuitzolli
    # Quetzal fan behind the head, grooved plume by plume.
    R, cz = 0.27, 0.88
    fan = [(R * math.cos(a), cz + R * math.sin(a)) for a in (math.pi * k / 14 for k in range(15))]
    solids.append(prism(fan, 0.10, 0.15, axis="y"))
    n = 27
    grooves = {(i, j) for i in range(-n, n) for j in range(0, n)
               if 0.42 * n < _r(i, j) < n - 1.5 and math.degrees(math.atan2(j + 0.5, i + 0.5)) % 12 < 2.4}
    cutters.append(on_front(grooves, R / n, 0.006, 0, cz, 0.10))
    n, cell = 12, 0.011
    cutters.append(on_front(square_field(n) - volute(n), cell, 0.006, 0, 0.49, -0.205))
    return solids, cutters
