"""Teocalli — the rook. The Templo Mayor: four talud tiers, twin stairways
with serpent-headed balustrades, and the twin shrines of Tlaloc and
Huitzilopochtli on the summit. Front is -Y."""
from kit import box, frustum, plinth, prism

TRIS = 18000
# Stairways and balustrades are the finest carving: weather the rest.
PROTECT = [((-0.17, 0.17), (-0.42, -0.12), (0.08, 0.62))]

TIERS = [(0.66, 0.60, 0.13), (0.56, 0.50, 0.12), (0.46, 0.41, 0.11), (0.36, 0.32, 0.10)]


def build(seed=7):
    solids, cutters = plinth()
    z = 0.085
    for w0, w1, h in TIERS:
        solids.append(frustum(w0, w0, w1, w1, z, z + h))
        ledge = w1 + 0.014  # the moulding that caps every tier
        solids.append(frustum(ledge, ledge, ledge, ledge, z + h - 0.014, z + h))
        z += h
    top = z

    # Twin stairways climbing the west (front) face.
    yb, yt, steps = -0.355, -0.165, 18
    rise, run = (top - 0.085) / steps, (yt - yb) / steps
    for cx in (-0.075, 0.075):
        for i in range(steps):
            solids.append(box(cx - 0.055, cx + 0.055, yb + i * run, yt + 0.03, 0.085, 0.085 + (i + 1) * rise))

    # Balustrades (alfardas) ending in serpent heads at the foot.
    for cx, w in ((-0.1425, 0.025), (0.0, 0.03), (0.1425, 0.025)):
        solids.append(prism([(yb - 0.012, 0.085), (yt + 0.05, top - 0.02),
                             (yt, top + 0.035), (yb - 0.012, 0.14)], cx - w / 2, cx + w / 2))
        solids.append(box(cx - w / 2 - 0.006, cx + w / 2 + 0.006, yb - 0.045, yb + 0.01, 0.085, 0.142, chip=True))

    # Summit shrines with doorways; Tlaloc's crest is ribbed, Huitzilopochtli's stepped.
    for cx in (-0.075, 0.075):
        solids.append(box(cx - 0.06, cx + 0.06, -0.10, 0.13, top, top + 0.13, chip=True))
        solids.append(box(cx - 0.05, cx + 0.05, -0.06, 0.10, top + 0.13, top + 0.17, chip=True))
        cutters.append(box(cx - 0.025, cx + 0.025, -0.13, -0.05, top - 0.005, top + 0.078))
    for dx in (-0.035, 0.0, 0.035):
        solids.append(box(-0.075 + dx - 0.01, -0.075 + dx + 0.01, -0.03, 0.07, top + 0.17, top + 0.205))
    solids.append(box(0.04, 0.11, -0.04, 0.08, top + 0.17, top + 0.195))
    solids.append(box(0.055, 0.095, -0.02, 0.06, top + 0.195, top + 0.22))
    return solids, cutters
