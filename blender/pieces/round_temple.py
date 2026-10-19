"""Temple of Ehecatl-Quetzalcoatl, the wind: a square stepped base with one
stairway, and on it a round drum shrine — round so the wind can pass —
under a ribbed conical roof. Front is -Y."""
from kit import box, cylinder, frustum, plinth, prism, rbox

STONES = ["cantera", "tezontle"]
RES = 1024
TRIS = 7500
PROTECT = [((-0.14, 0.14), (-0.52, -0.25), (0.05, 0.42)), ((-0.3, 0.3), (-0.3, 0.35), (0.38, 1.0))]

TIERS = [(0.86, 0.80, 0.12), (0.72, 0.66, 0.11), (0.58, 0.53, 0.10)]
C = (0.0, 0.03)  # the drum sits a little back, leaving a landing at the door


def build(seed=7):
    solids, cutters = plinth(size=1.0, h=0.06)
    z = 0.06
    for w0, w1, h in TIERS:
        solids.append(frustum(w0, w0, w1, w1, z, z + h))
        ledge = w1 + 0.016
        solids.append(frustum(ledge, ledge, ledge, ledge, z + h - 0.016, z + h))
        z += h
    top = z

    yb, yt, steps = -0.48, -0.265, 13
    rise, run = (top - 0.06) / steps, (yt - yb) / steps
    for i in range(steps):
        solids.append(box(-0.085, 0.085, yb + i * run, yt + 0.03, 0.06, 0.06 + (i + 1) * rise))
    for cx in (-0.1, 0.1):
        w = 0.03
        solids.append(prism([(yb - 0.012, 0.06), (yt + 0.05, top - 0.02), (yt, top + 0.035), (yb - 0.012, 0.115)],
                            cx - w / 2, cx + w / 2))
        solids.append(box(cx - w / 2 - 0.007, cx + w / 2 + 0.007, yb - 0.05, yb + 0.012, 0.06, 0.12, chip=True))

    # The drum: plinth ring, wall, cornice ring; a recessed doorway facing the stair.
    d0, d1 = top, top + 0.2
    solids += [cylinder(0.215, d0, d0 + 0.025, at=C), cylinder(0.2, d0, d1, at=C), cylinder(0.222, d1 - 0.02, d1 + 0.01, at=C)]
    cutters.append(box(-0.042, 0.042, -0.25, -0.09, d0 + 0.02, d0 + 0.14))
    # Conical roof with raised rings, a knob at the apex.
    r0, r1, h = 0.235, 0.03, 0.24
    solids.append(cylinder(r0, d1 + 0.01, d1 + 0.01 + h, at=C, r1=r1))
    for t in (0.22, 0.46, 0.7):
        r, zz = r0 + (r1 - r0) * t, d1 + 0.01 + h * t
        solids.append(cylinder(r + 0.012, zz - 0.009, zz + 0.009, at=C))
    solids.append(rbox(-0.03, 0.03, C[1] - 0.03, C[1] + 0.03, d1 + h, d1 + h + 0.05, 0.02))
    return solids, cutters
