"""Ocelotl — the knight. The jaguar warrior: his face looks out from the
jaws of the jaguar helmet — fangs, a heavy muzzle, short ears — and the
pelt's rosettes run down his body. Front is -Y."""
import math, random
from mathutils import Matrix, Vector
from kit import face, frustum, plinth, prism, rbox, relief, rosettes

TRIS = 17000


def build(seed=7):
    solids, cutters = plinth()
    solids += [frustum(0.52, 0.42, 0.48, 0.40, 0.085, 0.32, chip="sides"),
               frustum(0.54, 0.44, 0.54, 0.44, 0.305, 0.32),
               frustum(0.46, 0.38, 0.42, 0.36, 0.32, 0.60, chip="sides"),
               rbox(-0.23, 0.23, -0.20, 0.20, 0.585, 0.625, 0.012),
               rbox(-0.15, 0.15, -0.15, 0.15, 0.62, 0.78, 0.03),            # face block
               rbox(-0.20, 0.20, -0.19, 0.19, 0.76, 0.90, 0.05),            # jaguar head
               rbox(-0.13, 0.13, -0.29, -0.12, 0.775, 0.875, 0.035),        # muzzle
               rbox(-0.045, 0.045, -0.302, -0.27, 0.835, 0.877, 0.012),     # nose pad
               rbox(-0.13, 0.13, -0.25, -0.12, 0.60, 0.635, 0.015)]         # lower jaw
    f_solids, f_cut = face(0, 0.705, -0.15, 0.28)
    solids += f_solids
    cutters += f_cut
    for x in (-0.085, 0.085):                                               # fangs
        solids.append(prism([(x - 0.018, 0.78), (x + 0.018, 0.78), (x, 0.73)], -0.285, -0.255, axis="y"))
        solids.append(prism([(x - 0.015, 0.635), (x + 0.015, 0.635), (x, 0.672)], -0.245, -0.22, axis="y"))
    for x in (-0.13, 0.13):                                                 # ears
        solids.append(prism([(x - 0.065, 0.87), (x + 0.065, 0.87), (x + 0.035, 0.955), (x - 0.035, 0.955)],
                            -0.03, 0.05, axis="y", chip=True))
        cutters.append(prism([(x - 0.035, 0.885), (x + 0.035, 0.885), (x + 0.018, 0.94), (x - 0.018, 0.94)],
                             -0.05, -0.02, axis="y"))
    rng = random.Random(seed)                                               # rosettes
    cell = 0.0095
    w, h = int(0.36 / cell), int(0.24 / cell)
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2, 3, "Z")
        half = 0.188 if k % 2 == 0 else 0.222
        origin = R @ Vector((-w * cell / 2, -half, 0.335))
        cutters.append(relief(rosettes(rng, w, h, 5), cell, 0.005, origin,
                              R @ Vector((1, 0, 0)), Vector((0, 0, 1)), R @ Vector((0, -1, 0))))
    return solids, cutters
