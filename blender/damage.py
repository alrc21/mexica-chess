"""Broken board slabs: where a piece is destroyed, its square takes the blow.

    blender -b --factory-startup -P blender/damage.py -- 0          # slab variant 0..2, both levels
    blender -b --factory-startup -P blender/damage.py -- preview    # all six, one shot

Reads blender/out/slab/slab<v>-cantera.glb (andesite has the same geometry),
seals its underside and cuts it with jagged vertical cracks — 2D Voronoi cells
around an impact point, extruded into prisms — then writes
blender/out/slab/damage<v>-<L>.glb for L = 1 (cracked) and 2 (shattered):
one merged mesh in the unbroken pose with a morph target "settled" (cracks
open, plates tipped into a dish, lips bevelled — the runtime drives it at the
moment of the blow), plus "chip<i>" objects, the bits the blow throws out of
the crater. Materials "exterior" (original faces and UVs, so the slab bake
still maps) and "interior" (fresh cuts, planar UVs × 4, vertex colour darkening
with depth). Same space as the slab.
Ship with

    npx gltf-transform optimize blender/out/slab/damage<v>-<L>.glb public/models/damage/slab<v>-<L>.glb \
      --compress meshopt --simplify false --prune-attributes false
"""
import bpy, bmesh, sys, random, math, pathlib
from mathutils import Vector, noise

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit
from fracture import close, islands, material

args = sys.argv[sys.argv.index("--") + 1:]
OUT = kit.OUT / "slab"
BOX = 0.7    # 2D clip square, well outside the slab's ±0.495
Z = (-0.04, 0.1)  # crack prisms run right through the slab's thickness
CRUMB = 2e-6  # drop bits smaller than this (slab volume ≈ 0.063)


def load(v):
    bpy.ops.import_scene.gltf(filepath=str(OUT / f"slab{v}-cantera.glb"), merge_vertices=True)
    ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    textured = ob.data.materials[0]
    if "custom_normal" in ob.data.attributes:
        ob.data.attributes.remove(ob.data.attributes["custom_normal"])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    kit.remove(list(bpy.context.scene.objects))
    return bm, textured


def voronoi(pts):
    """2D Voronoi cells (convex polygons) clipped to the square ±BOX."""
    cells = []
    for i, p in enumerate(pts):
        poly = [Vector((-BOX, -BOX)), Vector((BOX, -BOX)), Vector((BOX, BOX)), Vector((-BOX, BOX))]
        for j, q in enumerate(pts):
            if i == j:
                continue
            m, n = (p + q) / 2, q - p
            inside = lambda a: (a - m).dot(n) <= 0
            out = []
            for k, a in enumerate(poly):
                b = poly[(k + 1) % len(poly)]
                if inside(a):
                    out.append(a)
                if inside(a) != inside(b):
                    t = (m - a).dot(n) / (b - a).dot(n)
                    out.append(a + (b - a) * t)
            poly = out
        cells.append(poly)
    return cells


def jagged(poly, seed):
    """Wiggle every crack edge with one noise field of world XY. A shared edge is
    walked in a canonical direction, so both cells either side get the very same
    points and still tile; ends stay put so junctions meet."""
    on_box = lambda a: abs(abs(a.x) - BOX) < 1e-6 or abs(abs(a.y) - BOX) < 1e-6
    key = lambda a: (round(a.x, 6), round(a.y, 6))
    out = []
    for k, a in enumerate(poly):
        b = poly[(k + 1) % len(poly)]
        out.append(a)
        if on_box(a) and on_box(b):
            continue
        A, B, flip = (a, b, False) if key(a) < key(b) else (b, a, True)
        d = B - A
        n_ = max(2, math.ceil(d.length / 0.016))
        side = Vector((-d.y, d.x)).normalized()
        scale = min(1.0, d.length / 0.35)
        pts = []
        for s in range(1, n_):
            t = s / n_
            p = A + d * t
            f = lambda fr, o: noise.noise(Vector((p.x * fr + o, p.y * fr, seed)))
            w = 0.026 * f(5, 0) * scale + 0.009 * f(19, 7.1) + 0.0035 * f(61, 3.3)
            pts.append(p + side * w * math.sin(math.pi * t) ** 0.5)
        out += reversed(pts) if flip else pts
    return out


def prism(poly):
    bm = bmesh.new()
    lo = [bm.verts.new((p.x, p.y, Z[0])) for p in poly]
    hi = [bm.verts.new((p.x, p.y, Z[1])) for p in poly]
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    for k in range(len(poly)):
        k1 = (k + 1) % len(poly)
        bm.faces.new((lo[k], lo[k1], hi[k1], hi[k]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.material_index = 1
    return bm


def split(slab, mats, poly):
    """slab ∩ prism(poly) → its loose parts, each as a bmesh with UVs."""
    cut = kit.from_bm("cell", prism(poly))
    for m in mats:
        cut.data.materials.append(m)
    ob = kit.link("part", slab.data.copy())
    mod = ob.modifiers.new("cut", "BOOLEAN")
    mod.operation, mod.object, mod.solver, mod.material_mode = "INTERSECT", cut, "EXACT", "INDEX"
    kit.apply_modifiers(ob)
    kit.remove([cut])
    part = bmesh.new()
    part.from_mesh(ob.data)
    kit.remove([ob])
    src_uv = part.loops.layers.uv.active
    subs = []
    for faces in islands(part):
        sub = bmesh.new()
        uv = sub.loops.layers.uv.new("UVMap")
        vmap = {}
        for f in faces:
            vs = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = sub.verts.new(v.co)
                vs.append(vmap[v])
            nf = sub.faces.new(vs)
            nf.material_index = f.material_index
            for a, b in zip(nf.loops, f.loops):
                a[uv].uv = b[src_uv].uv
        sub.normal_update()
        if abs(sub.calc_volume()) < CRUMB:
            sub.free()
            continue
        subs.append(sub)
    part.free()
    return subs


def settled(sub, c0, gap, tilt, sink, chamfer):
    """Where each vertex of a fragment ends up once the slab has given way:
    the crack opens (away from the impact), the inner side tips down about the
    fragment's outer edge (nothing rises above the slab), the whole sinks, and
    the lip of every cut breaks back into a bevel, so the crack reads as a
    groove from across the board. The fragment itself is left untouched: its
    pose is the morph target's basis, an unbroken slab."""
    ctr = sum((v.co for v in sub.verts), Vector()) / len(sub.verts)
    d = Vector((ctr.x - c0.x, ctr.y - c0.y, 0))
    d = d.normalized() if d.length > 1e-4 else Vector((1, 0, 0))
    rr = [(Vector((v.co.x - c0.x, v.co.y - c0.y, 0))).dot(d) for v in sub.verts]
    top = max(rr)
    k = math.tan(math.radians(tilt))
    lip = max(v.co.z for v in sub.verts) - 0.007
    out = []
    for v, r in zip(sub.verts, rr):
        co = v.co.copy()
        if chamfer and co.z > lip and any(f.material_index == 1 for f in v.link_faces):
            inward = Vector((ctr.x - co.x, ctr.y - co.y, 0))
            if inward.length > 1e-4:
                co += inward.normalized() * chamfer * (co.z - lip) / 0.007
                co.z -= chamfer * 0.6 * (co.z - lip) / 0.007
        co += d * gap
        co.z += k * (r - top) - sink
        out.append(co)
    return out


def build(v, level, slab, mats):
    """Fragments of one broken slab: [(bmesh, settled coords)] that stay, and
    the small central bits the blow throws out of the crater (flung at runtime)."""
    rng = random.Random(1009 * v + 31 * level)
    c0 = Vector((rng.uniform(-0.07, 0.07), rng.uniform(-0.07, 0.07)))

    def ring(n, r0, r1):
        turn = rng.uniform(0, 2 * math.pi)
        return [c0 + Vector((math.cos(a), math.sin(a))) * rng.uniform(r0, r1)
                for a in (turn + 2 * math.pi * (i + rng.uniform(-0.18, 0.18)) / n for i in range(n))]

    if level == 1:
        core = ring(3, 0.04, 0.07)
        pts = core + ring(rng.randint(5, 6), 0.3, 0.42)
    else:
        core = ring(4, 0.05, 0.08)
        pts = core + ring(rng.randint(6, 7), 0.26, 0.34)
    inner = len(core)
    pieces = []  # (bmesh, from an inner cell?)
    for i, poly in enumerate(voronoi(pts)):
        for sub in split(slab, mats, jagged(poly, seed=v * 3.7 + level)):
            pieces.append((sub, i < inner))
    # The blow throws the smallest central bits out: the crater.
    core = sorted((p for p in pieces if p[1]), key=lambda p: abs(p[0].calc_volume()))
    thrown = [p[0] for p in core[:1 if level == 1 else rng.randint(2, 3)]]
    kept = []
    for sub, central in pieces:
        if sub in thrown:
            continue
        if level == 1 and central:
            pose = settled(sub, c0, rng.uniform(0.003, 0.005), rng.uniform(5, 9), rng.uniform(0.008, 0.016), 0.004)
        elif level == 1:
            pose = settled(sub, c0, rng.uniform(0.008, 0.013), rng.uniform(2.5, 5), rng.uniform(0.002, 0.007), 0.006)
        elif central:
            pose = settled(sub, c0, rng.uniform(0.003, 0.006), rng.uniform(8, 14), rng.uniform(0.03, 0.045), 0.005)
        else:
            pose = settled(sub, c0, rng.uniform(0.013, 0.02), rng.uniform(3, 6.5), rng.uniform(0.003, 0.01), 0.008)
        kept.append((sub, pose))
    return kept, thrown


def shade(bm, uv):
    """Exterior faces smooth with their bake UVs; interior faces flat, planar UVs ×4,
    and a vertex colour that darkens with depth below the slab's top — a fresh cut
    is lit only at the lip and goes to shadow inside, so an open crack reads as a dark void."""
    col = bm.loops.layers.color.new("Color")
    top = max(v.co.z for v in bm.verts)
    for f in bm.faces:
        f.smooth = f.material_index == 0
        for lp in f.loops:
            if f.material_index != 1:
                lp[col] = (1, 1, 1, 1)
                continue
            t = max(0.0, min(1.0, (lp.vert.co.z - (top - 0.04)) / 0.04))
            c = 0.04 + 0.38 * t ** 2
            lp[col] = (c, c, c, 1)
        if f.material_index != 1:
            continue
        a = max(range(3), key=lambda k: abs(f.normal[k]))
        u, w = [k for k in range(3) if k != a]
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co[u] * 4, lp.vert.co[w] * 4)


def copy_into(bm, sub, uv):
    suv = sub.loops.layers.uv.active
    vmap = {v: bm.verts.new(v.co) for v in sub.verts}
    for f in sub.faces:
        nf = bm.faces.new([vmap[v] for v in f.verts])
        nf.material_index = f.material_index
        for a, b in zip(nf.loops, f.loops):
            a[uv].uv = b[suv].uv
    return [vmap[v] for v in sub.verts]


def colored(ob):
    """The depth shading is the mesh's one colour set: exported as COLOR_0."""
    attrs = ob.data.color_attributes
    attrs.active_color = attrs["Color"]
    attrs.render_color_index = 0
    return ob


def merge(kept, name, mats):
    """One mesh in the unbroken pose, with a shape key "settled" holding the broken one."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    pose = []
    for sub, coords in kept:
        copy_into(bm, sub, uv)
        pose += coords
        sub.free()
    bm.normal_update()
    shade(bm, uv)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])  # tangents need triangles
    ob = colored(kit.from_bm(name, bm))
    for m in mats:
        ob.data.materials.append(m)
    ob.shape_key_add(name="Basis")
    key = ob.shape_key_add(name="settled")
    for i, co in enumerate(pose):
        key.data[i].co = co
    return ob


def chip(sub, name, mats):
    """A thrown bit as its own object, in place."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    copy_into(bm, sub, uv)
    sub.free()
    bm.normal_update()
    shade(bm, uv)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    ob = colored(kit.from_bm(name, bm))
    for m in mats:
        ob.data.materials.append(m)
    return ob


def check(ob, n):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    holes = sum(e.is_boundary for e in bm.edges)
    print(f"{ob.name}: {n} pieces, {kit.tris(ob):,} tris, open edges {holes}, volume {bm.calc_volume(signed=True):.5f}")
    bm.free()


def main(v):
    kit.reset()
    bm, _ = load(v)
    close(bm)
    mats = [material("exterior", "#c9b79a"), material("interior", "#e6d3b5")]
    slab = kit.from_bm("slab", bm)
    for m in mats:
        slab.data.materials.append(m)
    for level in (1, 2):
        kept, thrown = build(v, level, slab, mats)
        ob = merge(kept, f"damage{v}-{level}", mats)
        check(ob, len(kept))
        chips = [chip(sub, f"chip{i}", mats) for i, sub in enumerate(thrown)]
        bpy.ops.object.select_all(action="DESELECT")
        for o in [ob, *chips]:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT / f"damage{v}-{level}.glb"), export_format="GLB", use_selection=True,
                                  export_apply=False, export_tangents=True, export_materials="EXPORT",
                                  export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_morph=True, export_morph_normal=True)
        kit.remove([ob, *chips])


def preview():
    """All six on a grid with the real cantera bake on top and pale cuts, raking light."""
    kit.reset()
    _, textured = load(0)
    pale = material("cut", "#efe2c8")
    obs = []
    for v in range(3):
        for level in (1, 2):
            bpy.ops.import_scene.gltf(filepath=str(OUT / f"damage{v}-{level}.glb"))
            for o in bpy.context.selected_objects:
                o.hide_render = o.name.startswith("chip")  # thrown out of the crater at runtime
            ob = next(o for o in bpy.context.selected_objects if o.data.shape_keys)
            ob.data.shape_keys.key_blocks["settled"].value = 1  # broken, as it settles in the game
            ob.location = ((v - 1) * 1.15, (level - 1.5) * -1.15, 0)
            for slot in ob.material_slots:
                slot.material = textured if slot.material.name.startswith("exterior") else pale
            obs.append(ob)
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.color = (0.05, 0.05, 0.05)
    sun = kit.link("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy, sun.data.angle = 4, 0.05
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    fill = kit.link("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.8
    fill.rotation_euler = (math.radians(30), 0, math.radians(-150))
    cam = kit.link("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    cam.location = Vector((0.0, -3.6, 3.4))
    cam.rotation_euler = (Vector((0, -0.1, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1500, 1000
    sc.cycles.samples, sc.cycles.use_denoising = 48, True
    sc.render.filepath = str(kit.HERE.parent / "docs" / "evidence" / "phase6-damage.jpg")
    sc.render.image_settings.file_format = "JPEG"
    bpy.ops.render.render(write_still=True)


if args[0] == "preview":
    preview()
else:
    main(int(args[0]))
