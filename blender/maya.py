"""Maya architecture of the Petén, as at Calakmul and Tikal, for the temples
that break through the forest. Unit scale (the base is 1 wide), front -Y,
ground at z = 0; the game scales them up.

  terraces  steep battered tiers, each with an apron moulding near its lip and
            inset corners — the Petén profile
  stairway  one steep flight up the front, between low sloping side walls
  temple    the shrine on top: three doorways, a medial moulding, a sloping
            upper frieze, and a tall roof comb pierced with openings
  ruin      what a thousand years did: fallen corners, gaps in the stair, a broken comb
"""
import math
from kit import box, frustum, hexa, prism


def terraces(tiers, z=0.0):
    """tiers: [(w, d, h)] from the ground up. Returns (solids, cutters, top z, [(w, d, z0, z1)])."""
    solids, cutters, spans = [], [], []
    for w, d, h in tiers:
        w1, d1 = w - 0.028, d - 0.028  # battered walls
        solids.append(frustum(w, d, w1, d1, z, z + h, chip="sides"))
        a = 0.012  # the apron: a projecting band just under the lip
        solids.append(frustum(w1 + a, d1 + a, w1 + a, d1 + a, z + h * 0.6, z + h * 0.84, chip="sides"))
        c = min(w, d) * 0.04  # inset corners, full height of the tier
        for sx in (-1, 1):
            for sy in (-1, 1):
                x0, x1 = sorted((sx * (w / 2 - c), sx * (w / 2 + 0.05)))
                y0, y1 = sorted((sy * (d / 2 - c), sy * (d / 2 + 0.05)))
                cutters.append(box(x0, x1, y0, y1, z - 0.001, z + h + 0.001))
        spans.append((w, d, z, z + h))
        z += h
    return solids, cutters, z, spans


def stairway(width, y_bottom, y_top, z_top, steps):
    """A steep flight from the ground at y_bottom up to z_top at y_top, with sloping side walls."""
    solids = []
    rise, run = z_top / steps, (y_top - y_bottom) / steps
    for i in range(steps):
        solids.append(box(-width / 2, width / 2, y_bottom + i * run, y_top + 0.01, 0, (i + 1) * rise))
    for sx in (-1, 1):  # alfardas: low walls flanking the flight
        x = sx * (width / 2 + 0.012)
        solids.append(prism([(y_bottom - 0.004, 0.0), (y_top + 0.01, z_top - 0.012), (y_top + 0.01, z_top + 0.022), (y_bottom - 0.004, 0.034)],
                            x - 0.012, x + 0.012))
    return solids


def temple(z, w=0.34, d=0.24, y=0.0, doors=3, comb=1.0, s=1.0):
    """The shrine on the summit at height z, centred on y, scaled by s; comb scales the roof comb's height."""
    solids, cutters = [], []
    W, D = w * s, d * s
    solids.append(box(-W / 2 - 0.02 * s, W / 2 + 0.02 * s, y - D / 2 - 0.03 * s, y + D / 2 + 0.02 * s, z, z + 0.02 * s, chip=True))  # platform
    z += 0.02 * s
    wall = 0.13 * s
    solids.append(box(-W / 2, W / 2, y - D / 2, y + D / 2, z, z + wall, chip=True))
    span = W * 0.62
    for i in range(doors):
        x = 0 if doors == 1 else -span / 2 + span * i / (doors - 1)
        cutters.append(box(x - 0.024 * s, x + 0.024 * s, y - D / 2 - 0.02, y - D / 2 + 0.07 * s, z, z + 0.085 * s))
    solids.append(box(-W / 2 - 0.01 * s, W / 2 + 0.01 * s, y - D / 2 - 0.01 * s, y + D / 2 + 0.01 * s, z + wall, z + wall + 0.016 * s, chip=True))  # medial moulding
    z += wall + 0.016 * s
    solids.append(frustum(W + 0.02 * s, D + 0.02 * s, W - 0.05 * s, D - 0.06 * s, z, z + 0.065 * s))  # sloping upper frieze
    z += 0.065 * s
    solids.append(box(-W / 2 + 0.03 * s, W / 2 - 0.03 * s, y - D / 2 + 0.035 * s, y + D / 2 - 0.035 * s, z, z + 0.012 * s))  # roof
    z += 0.012 * s
    # The roof comb rides the rear wall: a stack of thin slabs, pierced.
    cy, t = y + D * 0.16, 0.05 * s
    for w0, w1, h, holes in ((0.27, 0.22, 0.12, 4), (0.19, 0.15, 0.1, 3), (0.12, 0.09, 0.07, 2)):
        h *= comb
        solids.append(frustum(w0 * s, t, w1 * s, t * 0.85, z, z + h, y=cy, chip=True))
        for k in range(holes):
            x = (-0.5 + (k + 0.5) / holes) * w1 * s * 0.8
            for row in (0.22, 0.6):
                cutters.append(box(x - 0.013 * s, x + 0.013 * s, cy - t, cy + t, z + h * row, z + h * row + h * 0.24))
        z += h
    return solids, cutters, z


def wedge(cx, cy, z, size, depth, turn, tilt):
    """A slanted block cutter (a fallen corner, a broken comb): a box turned about z,
    its top face sheared so the break is not level."""
    c, s = math.cos(turn), math.sin(turn)
    p = lambda u, v, h: (cx + u * c - v * s, cy + u * s + v * c, h)
    hw, hd = size / 2, depth / 2
    lo = z - size * 0.6
    hi = z + size * 0.6
    return hexa([p(-hw, -hd, lo), p(hw, -hd, lo), p(hw, hd, lo), p(-hw, hd, lo)],
                [p(-hw, -hd, hi + tilt), p(hw, -hd, hi - tilt), p(hw, hd, hi - tilt), p(-hw, hd, hi + tilt)], chip=False)


def ruin(rng, spans, stair, comb_top):
    """Fallen corners on some tiers, bites out of the stair's edges, and the comb's top broken off."""
    cutters = []
    for w, d, z0, z1 in spans:
        if rng.random() < 0.55:
            sx, sy = rng.choice((-1, 1)), rng.choice((-1, 1))
            size = rng.uniform(0.06, 0.12)
            cutters.append(wedge(sx * w / 2, sy * d / 2, (z0 + z1) / 2 + rng.uniform(0, 0.03), size, size * rng.uniform(0.8, 1.3),
                                 rng.uniform(0, math.pi), rng.uniform(-0.02, 0.03)))
    width, y0, y1, z_top = stair
    for _ in range(rng.randint(2, 4)):
        k = rng.uniform(0.15, 0.85)
        sx = rng.choice((-1, 1))
        cutters.append(wedge(sx * width / 2, y0 + (y1 - y0) * k, z_top * k + 0.02, rng.uniform(0.04, 0.07), 0.09,
                             rng.uniform(-0.4, 0.4), rng.uniform(-0.01, 0.02)))
    x = rng.choice((-1, 1)) * rng.uniform(0.02, 0.06)
    cutters.append(wedge(x, 0, comb_top, 0.09, 0.4, rng.uniform(-0.5, 0.5), rng.uniform(0.01, 0.025)))
    return cutters
