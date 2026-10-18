"""Shared pipeline: sculpt a high-poly carving, retopo, bake it per stone, export GLB.

Pieces only describe shapes (solids, cutters, edges to chip). Everything that
makes them read as weathered volcanic stone lives here, so the whole set
shares one hand.
"""
import bpy, bmesh, math, random, pathlib
import numpy as np
from mathutils import Matrix, Vector

HERE = pathlib.Path(__file__).parent
ASSETS = HERE / "assets"
OUT = HERE / "out"

# Edges registered for chipping while a piece is being built: (a, b, centre of
# the solid they belong to), so a chip knows which way is "outside".
EDGES: list[tuple[Vector, Vector, Vector]] = []


def lin(hex_: str):
    """sRGB hex → linear RGBA, which is what node colours expect."""
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], 1.0)


# ── Stones ──────────────────────────────────────────────────────────────────
STONES = {
    # Red tezontle: oxide red, open vesicles everywhere, dry and matte.
    "tezontle": dict(
        scan="rock_05", scale=6,
        ramp=[(0.0, "#1d0805"), (0.35, "#4a160d"), (0.7, "#7a2c1b"), (1.0, "#9e4a33")],
        blotch="#2e0c07", edge="#a8664b", cavity="#120504", pore="#070201",
        rough=(0.8, 0.98), polish=0.0, pores=dict(scale=46, size=0.3, cover=0.62),
    ),
    # Basalt: near-black and matte, edges polished by handling.
    "basalt": dict(
        scan="dark_rock", scale=5,
        ramp=[(0.0, "#040404"), (0.4, "#0a0a0a"), (0.75, "#141413"), (1.0, "#22211f")],
        blotch="#1a1918", edge="#3a3835", cavity="#020202", pore="#010101",
        rough=(0.62, 0.9), polish=0.35, pores=dict(scale=40, size=0.1, cover=0.15),
    ),
}


# ── Scene ───────────────────────────────────────────────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    EDGES.clear()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    sc.cycles.device = "GPU"


def link(name, me):
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me)


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old, ob.data = ob.data, me
    ob.modifiers.clear()
    bpy.data.meshes.remove(old)


def remove(obs):
    for o in obs:
        bpy.data.objects.remove(o, do_unlink=True)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ── Shapes ──────────────────────────────────────────────────────────────────
def hexa(bottom, top, chip=True, name="part"):
    """Solid from 4 bottom + 4 top corners (counter-clockwise seen from above)."""
    bm = bmesh.new()
    b = [bm.verts.new(p) for p in bottom]
    t = [bm.verts.new(p) for p in top]
    bm.faces.new(b[::-1])
    bm.faces.new(t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((b[i], b[j], t[j], t[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if chip:
        c = sum((Vector(q) for q in bottom + top), Vector()) / 8
        for i in range(4):
            EDGES.append((Vector(top[i]), Vector(top[(i + 1) % 4]), c))
            EDGES.append((Vector(bottom[i]), Vector(top[i]), c))
    return from_bm(name, bm)


def frustum(w0, d0, w1, d1, z0, z1, x=0.0, y=0.0, chip=True):
    """A talud: rectangle w0×d0 at z0 narrowing to w1×d1 at z1."""
    q = lambda w, d, z: [(x - w / 2, y - d / 2, z), (x + w / 2, y - d / 2, z),
                         (x + w / 2, y + d / 2, z), (x - w / 2, y + d / 2, z)]
    return hexa(q(w0, d0, z0), q(w1, d1, z1), chip)


def box(x0, x1, y0, y1, z0, z1, chip=False):
    q = lambda z: [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    return hexa(q(z0), q(z1), chip)


def prism(profile_yz, x0, x1, chip=False):
    """A convex 4-point profile in YZ, extruded along X."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in profile_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in profile_yz]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = from_bm("prism", bm)
    if chip:
        c = Vector(((x0 + x1) / 2, *(sum(q[k] for q in profile_yz) / 4 for k in (0, 1))))
        for (y0, z0), (y1, z1) in zip(profile_yz, profile_yz[1:] + profile_yz[:1]):
            EDGES.append((Vector((x0, y0, z0)), Vector((x0, y1, z1)), c))
            EDGES.append((Vector((x1, y0, z0)), Vector((x1, y1, z1)), c))
    return ob


def relief(cells, cell, depth, origin, u, v, n):
    """Cutter for a carved pixel motif.

    cells: set of (i, j) grid cells to carve. The cutter spans from `depth`
    inside the surface to a little outside it along normal `n`.
    """
    origin, u, v, n = map(Vector, (origin, u, v, n))
    bm = bmesh.new()
    vert = {}

    def p(i, j, k):
        key = (i, j, k)
        if key not in vert:
            vert[key] = bm.verts.new(origin + u * (i * cell) + v * (j * cell) + n * (0.01 if k else -depth))
        return vert[key]

    for i, j in cells:
        bm.faces.new((p(i, j, 1), p(i + 1, j, 1), p(i + 1, j + 1, 1), p(i, j + 1, 1)))
        bm.faces.new((p(i, j, 0), p(i, j + 1, 0), p(i + 1, j + 1, 0), p(i + 1, j, 0)))
        for (di, dj), (a, b) in {(0, -1): ((0, 0), (1, 0)), (1, 0): ((1, 0), (1, 1)),
                                 (0, 1): ((1, 1), (0, 1)), (-1, 0): ((0, 1), (0, 0))}.items():
            if (i + di, j + dj) not in cells:
                (ai, aj), (bi, bj) = a, b
                bm.faces.new((p(i + ai, j + aj, 0), p(i + bi, j + bj, 0),
                              p(i + bi, j + bj, 1), p(i + ai, j + aj, 1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bm("relief", bm)


def raster(polylines):
    """Grid cells covered by axis-aligned polylines of integer points."""
    cells = set()
    for line in polylines:
        for (x0, y0), (x1, y1) in zip(line, line[1:]):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                for y in range(min(y0, y1), max(y0, y1) + 1):
                    cells.add((x, y))
    return cells


def meander(units):
    """Mitla-style square-spiral greca, `units` repeats, 7 cells tall."""
    lines = []
    for k in range(units):
        o = 8 * k
        lines.append([(o, 0), (o, 6), (o + 6, 6), (o + 6, 2), (o + 2, 2), (o + 2, 4), (o + 4, 4)])
        lines.append([(o, 0), (o + 8, 0)])
    return {c for c in raster(lines) if c[0] < 8 * units}


def plinth(size=0.76, h=0.085):
    """The base every piece stands on: a block wrapped in a carved greca band."""
    solids = [box(-size / 2, size / 2, -size / 2, size / 2, 0, h)]
    s = size / 2
    c = Vector((0, 0, h / 2))
    for i in range(4):  # top + vertical edges chip, the bottom sits on the board
        a = Vector(((-s, -s), (s, -s), (s, s), (-s, s))[i] + (h,))
        b = Vector(((-s, -s), (s, -s), (s, s), (-s, s))[(i + 1) % 4] + (h,))
        EDGES.extend([(a, b, c), (a - Vector((0, 0, h)), a, c)])
    units = int((size - 0.06) / (0.0068 * 8))
    cell = 0.0068
    span = units * 8 * cell
    z0 = h / 2 - 3.5 * cell
    cells = meander(units)
    rot = lambda a: Matrix.Rotation(a, 3, "Z")
    cutters = []
    for k in range(4):
        R = rot(k * math.pi / 2)  # side k faces -Y rotated by k quarter turns
        origin = R @ Vector((-span / 2, -s, z0))
        cutters.append(relief(cells, cell, 0.0035, origin, R @ Vector((1, 0, 0)),
                              Vector((0, 0, 1)), R @ Vector((0, -1, 0))))
    return solids, cutters


# ── Sculpt ──────────────────────────────────────────────────────────────────
def join(obs, name):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for o in obs:
        bm.from_mesh(o.data)
    bm.to_mesh(me)
    bm.free()
    remove(obs)
    return link(name, me)


def chips(rng, protect=(), density=30, keep=0.5):
    """Stone knocked off the registered edges.

    Two kinds, both cut only from the outside of the edge so faces never get
    holes: flat facets (a blade shaved the corner, tapering out along the
    edge) and shallow conchoidal scoops (a sphere far outside, just grazing).
    `protect` boxes ((x0, x1), (y0, y1), (z0, z1)) keep fine carving intact.
    """
    inside = lambda p: any(all(lo <= p[k] <= hi for k, (lo, hi) in enumerate(b)) for b in protect)
    out = []
    for a, b, c in EDGES:
        d = (b - a).normalized()
        mid = (a + b) / 2
        n = (mid - c) - d * (mid - c).dot(d)  # outward bisector, square to the edge
        if n.length < 1e-6:
            continue
        n.normalize()
        count = max(1, int((b - a).length * density))
        for i in range(count):
            if rng.random() > keep:
                continue
            p = a.lerp(b, (i + rng.random()) / count)
            if inside(p):
                continue
            nn = (Matrix.Rotation(rng.uniform(-0.3, 0.3), 3, d) @ n).normalized()
            depth = rng.uniform(0.0015, 0.006)
            bm = bmesh.new()
            if rng.random() < 0.6:
                L, T = rng.uniform(0.01, 0.035), 0.03
                bmesh.ops.create_cube(bm, size=1)
                side = nn.cross(d).normalized()
                taper = Matrix.Rotation(rng.uniform(-0.12, 0.12), 3, side)
                x, z = taper @ d, taper @ nn
                y = z.cross(x)
                basis = Matrix((x, y, z)).transposed().to_4x4()
                m = (Matrix.Translation(p - nn * depth + z * (T / 2)) @ basis
                     @ Matrix.Diagonal((L, 0.05, T, 1)))
            else:
                R = rng.uniform(0.015, 0.03)
                bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R)
                m = (Matrix.Translation(p + nn * (R - depth))
                     @ Matrix.Rotation(rng.uniform(0, math.tau), 4, nn)
                     @ Matrix.Diagonal((1, rng.uniform(0.7, 1), 1, 1)))
            bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
            out.append(from_bm("chip", bm))
    return out


def noise_tex(kind, size, depth=2):
    t = bpy.data.textures.new(kind.lower(), kind)
    t.noise_scale = size
    if hasattr(t, "noise_depth"):
        t.noise_depth = depth
    return t


def sculpt(solids, cutters, protect=(), seed=7, voxel=0.0022):
    rng = random.Random(seed)
    cutters = cutters + chips(rng, protect)
    hi = join(solids, "hi")
    m = hi.modifiers.new("union", "REMESH")
    m.mode, m.voxel_size = "VOXEL", voxel * 1.5
    apply_modifiers(hi)

    coll = bpy.data.collections.new("cutters")
    bpy.context.scene.collection.children.link(coll)
    for c in cutters:
        bpy.context.collection.objects.unlink(c)
        coll.objects.link(c)
    m = hi.modifiers.new("carve", "BOOLEAN")
    m.operation, m.operand_type, m.collection, m.solver = "DIFFERENCE", "COLLECTION", coll, "MANIFOLD"
    apply_modifiers(hi)
    remove(list(coll.objects))
    bpy.data.collections.remove(coll)

    m = hi.modifiers.new("soften", "REMESH")  # rounds every cut a little, like worn stone
    m.mode, m.voxel_size = "VOXEL", voxel
    for kind, size, strength in (("CLOUDS", 0.22, 0.006), ("CLOUDS", 0.05, 0.0016)):
        d = hi.modifiers.new(kind, "DISPLACE")
        d.texture, d.texture_coords, d.strength = noise_tex(kind, size), "LOCAL", strength
    apply_modifiers(hi)
    for p in hi.data.polygons:
        p.use_smooth = True
    print(f"hi: {tris(hi):,} tris")
    return hi


def retopo(hi, target):
    lo = link("lo", hi.data.copy())
    m = lo.modifiers.new("dec", "DECIMATE")
    m.ratio = target / tris(hi)
    apply_modifiers(lo)
    bm = bmesh.new()  # the underside sits on the board: don't spend texels on it
    bm.from_mesh(lo.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.95 and f.calc_center_median().z < 0.004],
                     context="FACES")
    bm.to_mesh(lo.data)
    bm.free()
    bpy.context.view_layer.objects.active = lo
    for o in bpy.context.view_layer.objects:
        o.select_set(o is lo)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.002)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"lo: {tris(lo):,} tris")
    return lo


# ── Materials ───────────────────────────────────────────────────────────────
class Graph:
    """Tiny helper so node graphs read top to bottom."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()

    def __call__(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, out, inp):
        self.nt.links.new(out, inp)


def sock(sockets, ident):
    return next(s for s in sockets if s.identifier == ident or s.name == ident)


def image(path, color=True):
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    return img


def stone_material(name):
    s = STONES[name]
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    tc = g("ShaderNodeTexCoord")
    mp = g("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (s["scale"],) * 3
    g.link(tc.outputs["Object"], mp.inputs["Vector"])

    def scan(map_, color):
        n = g("ShaderNodeTexImage", projection="BOX", projection_blend=0.3,
              image=image(ASSETS / s["scan"] / f"{map_}.jpg", color))
        g.link(mp.outputs["Vector"], n.inputs["Vector"])
        return n

    diff, rough, disp = scan("diff", True), scan("rough", False), scan("disp", False)

    lum = g("ShaderNodeRGBToBW")
    g.link(diff.outputs["Color"], lum.inputs["Color"])
    ramp = g("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    for i, (pos, hx) in enumerate(s["ramp"]):
        e = els[i] if i < len(els) else els.new(pos)
        e.position, e.color = pos, lin(hx)
    g.link(lum.outputs["Val"], ramp.inputs["Fac"])

    # Vesicles: voronoi cells, kept only where a slow noise says the gas was.
    p = s["pores"]
    vor = g("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = p["scale"]
    g.link(tc.outputs["Object"], vor.inputs["Vector"])
    pore = g("ShaderNodeMapRange")
    pore.inputs["From Min"].default_value, pore.inputs["From Max"].default_value = 0, p["size"]
    pore.inputs["To Min"].default_value, pore.inputs["To Max"].default_value = 1, 0
    g.link(vor.outputs["Distance"], pore.inputs["Value"])
    cluster = g("ShaderNodeTexNoise")
    cluster.inputs["Scale"].default_value = 9
    g.link(tc.outputs["Object"], cluster.inputs["Vector"])
    gate = g("ShaderNodeMapRange")
    gate.inputs["From Min"].default_value = 1 - p["cover"] - 0.04
    gate.inputs["From Max"].default_value = 1 - p["cover"] + 0.04
    g.link(cluster.outputs["Fac"], gate.inputs["Value"])
    pores = g("ShaderNodeMath", operation="MULTIPLY")
    g.link(pore.outputs["Result"], pores.inputs[0])
    g.link(gate.outputs["Result"], pores.inputs[1])

    # Wear: exposed edges lighten, recesses hold dirt.
    geo = g("ShaderNodeNewGeometry")
    edge = g("ShaderNodeMapRange")
    edge.inputs["From Min"].default_value, edge.inputs["From Max"].default_value = 0.5, 0.62
    edge.inputs["To Max"].default_value = 0.55
    g.link(geo.outputs["Pointiness"], edge.inputs["Value"])
    ao = g("ShaderNodeAmbientOcclusion", samples=16, only_local=True)
    ao.inputs["Distance"].default_value = 0.025
    cav = g("ShaderNodeMath", operation="SUBTRACT")
    cav.inputs[0].default_value = 1
    g.link(ao.outputs["AO"], cav.inputs[1])

    def mix(a, color, fac, blend="MIX"):
        m = g("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        g.link(a, sock(m.inputs, "A_Color"))
        sock(m.inputs, "B_Color").default_value = lin(color)
        g.link(fac, sock(m.inputs, "Factor_Float"))
        return sock(m.outputs, "Result_Color")

    # Slow blotches: no quarry block is one colour.
    blot = g("ShaderNodeTexNoise")
    blot.inputs["Scale"].default_value = 3.5
    blot.inputs["Detail"].default_value = 4
    g.link(tc.outputs["Object"], blot.inputs["Vector"])
    bf = g("ShaderNodeMapRange")
    bf.inputs["From Min"].default_value, bf.inputs["From Max"].default_value = 0.4, 0.65
    bf.inputs["To Max"].default_value = 0.7
    g.link(blot.outputs["Fac"], bf.inputs["Value"])

    c = mix(ramp.outputs["Color"], s["blotch"], bf.outputs["Result"])
    c = mix(c, s["edge"], edge.outputs["Result"])
    c = mix(c, s["cavity"], cav.outputs["Value"])
    c = mix(c, s["pore"], pores.outputs["Value"])

    r = g("ShaderNodeMapRange")
    r.inputs["To Min"].default_value, r.inputs["To Max"].default_value = s["rough"]
    g.link(rough.outputs["Color"], r.inputs["Value"])
    worn = g("ShaderNodeMath", operation="MULTIPLY_ADD")  # rough - polish·edge
    g.link(edge.outputs["Result"], worn.inputs[0])
    worn.inputs[1].default_value = -s["polish"] / 0.55
    g.link(r.outputs["Result"], worn.inputs[2])

    h = g("ShaderNodeMath", operation="MULTIPLY_ADD")  # height = disp - 1.2·pores
    g.link(pores.outputs["Value"], h.inputs[0])
    h.inputs[1].default_value = -1.2
    g.link(disp.outputs["Color"], h.inputs[2])
    bump = g("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.9
    bump.inputs["Distance"].default_value = 0.0018
    g.link(h.outputs["Value"], bump.inputs["Height"])

    bsdf = g("ShaderNodeBsdfPrincipled")
    g.link(c, bsdf.inputs["Base Color"])
    g.link(worn.outputs["Value"], bsdf.inputs["Roughness"])
    g.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = g("ShaderNodeOutputMaterial")
    g.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# ── Bake + export ───────────────────────────────────────────────────────────
def pixels(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def save(img, path):
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()


def bake(hi, lo, stone, res, out_dir):
    """Bake stone onto lo; returns {base, orm, nor} image datablocks (also saved)."""
    hi.data.materials.clear()
    hi.data.materials.append(stone_material(stone))
    target = bpy.data.materials.new("bake")
    lo.data.materials.clear()
    lo.data.materials.append(target)
    node = target.node_tree.nodes.new("ShaderNodeTexImage")
    target.node_tree.nodes.active = node

    for o in bpy.context.view_layer.objects:
        o.select_set(o in (hi, lo))
    bpy.context.view_layer.objects.active = lo
    sc = bpy.context.scene
    maps = {}
    for key, kind, color, samples in (("base", "DIFFUSE", True, 16), ("rough", "ROUGHNESS", False, 16),
                                      ("nor", "NORMAL", False, 16), ("ao", "AO", False, 256)):
        img = bpy.data.images.new(f"{stone}_{key}", res, res, alpha=False)
        img.colorspace_settings.name = "sRGB" if color else "Non-Color"
        node.image = img
        sc.cycles.samples = samples
        bpy.ops.object.bake(type=kind, pass_filter={"COLOR"}, use_selected_to_active=True,
                            cage_extrusion=0.01, max_ray_distance=0.03, margin=16, use_clear=True)
        maps[key] = img
        print(f"  baked {stone} {key}")

    orm = bpy.data.images.new(f"{stone}_orm", res, res, alpha=False)
    orm.colorspace_settings.name = "Non-Color"
    ao, rough = pixels(maps["ao"]), pixels(maps["rough"])
    orm.pixels.foreach_set(np.stack([ao[:, 0], rough[:, 0], np.zeros(len(ao)), np.ones(len(ao))], 1).astype(np.float32).ravel())
    out = {"base": maps["base"], "orm": orm, "nor": maps["nor"]}
    for k, img in out.items():
        save(img, out_dir / f"{stone}_{k}.png")
    bpy.data.materials.remove(target)
    return out


def gltf_output_group():
    """The node group the glTF exporter reads ambient occlusion from."""
    ng = bpy.data.node_groups.get("glTF Material Output")
    if not ng:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def export_material(stone, maps):
    mat = bpy.data.materials.new(stone)
    mat.use_backface_culling = True  # glTF doubleSided: false
    g = Graph(mat)
    base = g("ShaderNodeTexImage", image=maps["base"])
    orm = g("ShaderNodeTexImage", image=maps["orm"])
    nor = g("ShaderNodeTexImage", image=maps["nor"])
    sep = g("ShaderNodeSeparateColor")
    g.link(orm.outputs["Color"], sep.inputs["Color"])
    nm = g("ShaderNodeNormalMap")
    g.link(nor.outputs["Color"], nm.inputs["Color"])
    bsdf = g("ShaderNodeBsdfPrincipled")
    g.link(base.outputs["Color"], bsdf.inputs["Base Color"])
    g.link(sep.outputs["Green"], bsdf.inputs["Roughness"])
    g.link(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    g.link(nm.outputs["Normal"], bsdf.inputs["Normal"])
    occ = g("ShaderNodeGroup")
    occ.node_tree = gltf_output_group()
    g.link(sep.outputs["Red"], occ.inputs["Occlusion"])
    out = g("ShaderNodeOutputMaterial")
    g.link(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def export(lo, name, mat, path):
    lo.name = name
    lo.data.materials.clear()
    lo.data.materials.append(mat)
    for o in bpy.context.view_layer.objects:
        o.select_set(o is lo)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True, export_tangents=True, export_image_format="AUTO")
    print(f"  → {path.name}")


def preview(hi, lo, path):
    """Cycles beauty shot: sculpt (left) beside the baked game mesh (right)."""
    sc = bpy.context.scene
    for o, x in ((hi, -0.5), (lo, 0.5)):
        o.location.x, o.rotation_euler.z = x, math.radians(-28)
    w = bpy.data.worlds.new("w")
    sc.world = w
    g = Graph(w)
    env = g("ShaderNodeTexEnvironment", image=image(ASSETS / "studio_kontrast_03.hdr", False))
    bg = g("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.22
    g.link(env.outputs["Color"], bg.inputs["Color"])
    g.link(bg.outputs["Background"], g("ShaderNodeOutputWorld").inputs["Surface"])

    floor = from_bm("floor", _plane(6))
    fm = bpy.data.materials.new("floor")
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = lin("#0b0a08")
    floor.data.materials.append(fm)

    for name, energy, size, color, loc in (("key", 70, 1.0, (1.0, 0.88, 0.76), (-1.6, -1.8, 2.2)),
                                           ("rim", 90, 0.6, (1.0, 0.95, 0.9), (1.9, 1.1, 1.3))):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size, light.color = energy, size, color
        lo_ = link(name, light)
        lo_.location = loc
        lo_.rotation_euler = (Vector((0, 0, 0.3)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    cam = link("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 52
    cam.location = (0, -3.6, 1.6)
    cam.rotation_euler = (math.radians(70), 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.cycles.samples, sc.cycles.use_denoising = 128, True
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for o in (hi, lo):
        o.location.x = o.rotation_euler.z = 0
    print(f"  preview → {path.name}")


def _plane(size):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    return bm
