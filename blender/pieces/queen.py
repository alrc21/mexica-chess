"""Cihuacoatl — the queen. A woman in skirt and quechquemitl cape, hair
bound in the two tufts of Mexica women, a sun disk carved with Ollin —
movement, she goes every way — rising behind. Front is -Y."""
from kit import cylinder, disc_field, face, frustum, meander, ollin, on_front, plinth, prism, rbox, relief

TRIS = 20000


def build(seed=7):
    solids, cutters = plinth()
    solids += [frustum(0.56, 0.44, 0.50, 0.42, 0.085, 0.42, chip="sides"),   # skirt (cueitl)
               frustum(0.54, 0.45, 0.54, 0.45, 0.405, 0.42),                 # waist band
               frustum(0.48, 0.40, 0.44, 0.38, 0.42, 0.62, chip="sides"),    # torso
               prism([(-0.25, 0.625), (0.25, 0.625), (0.0, 0.43)], -0.215, -0.185, axis="y"),  # quechquemitl
               rbox(-0.24, 0.24, -0.21, 0.21, 0.60, 0.64, 0.012),            # collar
               rbox(-0.15, 0.15, -0.15, 0.15, 0.64, 0.82, 0.035)]            # head
    for x in (-0.075, 0.075):                                                # hair tufts
        solids.append(rbox(x - 0.05, x + 0.05, -0.08, 0.06, 0.79, 0.88, 0.035))
    f_solids, f_cut = face(0, 0.735, -0.15, 0.30)
    solids += f_solids
    cutters += f_cut
    cell, units = 0.0068, 8                                                  # greca at the hem
    cutters.append(relief(meander(units), cell, 0.0035, (-units * 4 * cell, -0.218, 0.125),
                          (1, 0, 0), (0, 0, 1), (0, -1, 0)))
    r, z = 0.155, 0.92                                                       # sun disk
    solids.append(cylinder(r, 0.06, 0.12, axis="y", at=(0.0, z)))
    n = 18
    cutters.append(on_front(disc_field(n) - ollin(n), r / n, 0.006, 0, z, 0.06))
    return solids, cutters
