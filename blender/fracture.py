"""Pre-fracture a piece into convex Voronoi chunks for the capture effect.

    blender -b --factory-startup -P blender/fracture.py -- pawn [--no-preview]

Reads the baked game mesh (blender/out/<piece>/<piece>-tezontle.glb; basalt has
the same geometry), closes its underside, cuts it with Voronoi cells and writes
blender/out/<piece>/shards.glb: one node per chunk (chunk_00…), origin at the
chunk's bounds centre, materials "exterior" (original faces and UVs, so the
baked atlas still maps) and "interior" (fresh cuts, planar UVs × 4). Ship with

    npx gltf-transform optimize blender/out/<piece>/shards.glb public/models/shards/<piece>.glb \
      --compress meshopt --simplify false --join false --flatten false --instance false --palette false
"""
import bpy, bmesh, sys, random, math, pathlib
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit

COUNT = dict(pawn=11, knight=15, bishop=15, queen=17, king=17, rook=19)
CRUMB = 0.004  # drop loose bits below this share of the piece's volume

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
out = kit.OUT / name


def material(label, hex_):
    m = bpy.data.materials.new(label)
    m.use_backface_culling = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = kit.lin(hex_)
    return m


def load():
    bpy.ops.import_scene.gltf(filepath=str(out / f"{name}-tezontle.glb"), merge_vertices=True)
    ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    textured = ob.data.materials[0]
    # Normals: recomputed smooth (as baked) rather than the importer's encoded copy,
    # which would go stale where the cuts change the topology.
    if "custom_normal" in ob.data.attributes:
        ob.data.attributes.remove(ob.data.attributes["custom_normal"])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    remove = [o for o in bpy.context.scene.objects]
    kit.remove(remove)
    return bm, textured


def close(bm):
    """The bake dropped the underside; seal it so every chunk is a solid."""
    open_ = [e for e in bm.edges if e.is_boundary]
    new = bmesh.ops.holes_fill(bm, edges=open_, sides=0)["faces"]
    bmesh.ops.triangulate(bm, faces=new)
    for f in bm.faces:
        f.material_index = 1 if f.normal.z < -0.95 and f.calc_center_median().z < 0.01 else 0
    bad = [e for e in bm.edges if not e.is_manifold]
    print(f"capped {len(open_)} open edges; non-manifold left: {len(bad)}")
    return bm


def seeds(bm, n, rng):
    tree = BVHTree.FromBMesh(bm)
    lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    gap = 0.62 * (bm.calc_volume() / n) ** (1 / 3)
    pts = []
    for _ in range(60000):
        p = Vector([rng.uniform(lo[i], hi[i]) for i in range(3)])
        if rng.random() > 0.45 + 0.55 * (p.z - lo.z) / (hi.z - lo.z):  # denser toward the top
            continue
        hit, normal, _, _ = tree.find_nearest(p)
        if hit is None or (hit - p).dot(normal) <= 0:  # outside
            continue
        if all((p - q).length > gap for q in pts):
            pts.append(p)
            if len(pts) == n:
                break
    return pts, lo, hi


def cell(i, pts, lo, hi):
    """Convex Voronoi cell of pts[i], clipped to a box around the piece."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c, s = (lo + hi) / 2, (hi - lo) * 1.2 + Vector((0.05, 0.05, 0.05))
    for v in bm.verts:
        v.co = c + Vector((v.co.x * s.x, v.co.y * s.y, v.co.z * s.z))
    for j, q in enumerate(pts):
        if j == i:
            continue
        no = (q - pts[i]).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(q + pts[i]) / 2, plane_no=no, clear_outer=True)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        if not bm.verts:
            break
    for f in bm.faces:
        f.material_index = 1
    return bm


def islands(bm):
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, part = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        parts.append(part)
    return parts


def roughen(bm, edge=0.1, amp=0.014):
    """Break the flat Voronoi planes into a stone fracture: refine the cut faces,
    then push their inner vertices along the plane by a noise of world position.
    Both chunks of a cut see the same function, so they still fit together;
    vertices on ridges and on the carved skin stay put."""
    flat = lambda e: (len(e.link_faces) == 2 and all(f.material_index == 1 for f in e.link_faces)
                      and e.link_faces[0].normal.angle(e.link_faces[1].normal, 1) < 0.02)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(6):
        long_ = [e for e in bm.edges if e.calc_length() > edge and flat(e)]
        if not long_:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_, cuts=1)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.normal_update()
    for v in bm.verts:
        fs = v.link_faces
        if not fs or any(f.material_index != 1 for f in fs) or any(f.normal.angle(fs[0].normal, 1) > 0.02 for f in fs):
            continue
        n = fs[0].normal.copy()
        if n[max(range(3), key=lambda k: abs(n[k]))] < 0:
            n.negate()  # one direction per plane, whichever chunk owns it
        d = noise.noise(v.co * 7) * 0.65 + noise.noise(v.co * 23 + Vector((3.1, 7.7, 1.3))) * 0.35
        v.co += n * d * amp * 2
    bm.normal_update()


def finish(bm):
    """Interior faces: flat, planar UVs on their dominant axis. Exterior: smooth as baked."""
    roughen(bm)
    uv = bm.loops.layers.uv.active
    for f in bm.faces:
        f.smooth = f.material_index == 0
        if f.material_index != 1:
            continue
        a = max(range(3), key=lambda k: abs(f.normal[k]))
        u, v = [k for k in range(3) if k != a]
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co[u] * 4, lp.vert.co[v] * 4)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])  # tangents need triangles


def main():
    kit.reset()
    rng = random.Random(sum(map(ord, name)))
    bm, textured = load()
    close(bm)
    total = bm.calc_volume()
    pts, lo, hi = seeds(bm, COUNT[name], rng)
    mats = [material("exterior", "#7a2c1b"), material("interior", "#b98a6c")]
    piece = kit.from_bm("piece", bm)
    for m in mats:
        piece.data.materials.append(m)
    print(f"{len(pts)} seeds")

    chunks = []
    for i in range(len(pts)):
        cut = kit.from_bm(f"cell{i}", cell(i, pts, lo, hi))
        cut.data.materials.append(mats[0])
        cut.data.materials.append(mats[1])
        ob = kit.link(f"part{i}", piece.data.copy())
        mod = ob.modifiers.new("cut", "BOOLEAN")
        mod.operation, mod.object, mod.solver, mod.material_mode = "INTERSECT", cut, "EXACT", "INDEX"
        kit.apply_modifiers(ob)
        kit.remove([cut])
        part = bmesh.new()
        part.from_mesh(ob.data)
        kit.remove([ob])
        for faces in islands(part):
            sub = bmesh.new()
            uv = sub.loops.layers.uv.new("UVMap")
            src_uv = part.loops.layers.uv.active
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
            if abs(sub.calc_volume()) < CRUMB * total:
                sub.free()
                continue
            finish(sub)
            chunks.append(sub)
        part.free()
    kit.remove([piece])

    obs = []
    for k, sub in enumerate(chunks):
        lo_ = Vector([min(v.co[i] for v in sub.verts) for i in range(3)])
        hi_ = Vector([max(v.co[i] for v in sub.verts) for i in range(3)])
        c = (lo_ + hi_) / 2
        for v in sub.verts:
            v.co -= c
        ob = kit.from_bm(f"chunk_{k:02d}", sub)
        ob.data.name = f"chunk_{k:02d}"
        ob.location = c
        for m in mats:
            ob.data.materials.append(m)
        obs.append(ob)
    tris = sum(kit.tris(o) for o in obs)
    print(f"{name}: {len(obs)} chunks, {tris:,} tris")
    for o in obs:  # every chunk should be a closed solid with outward normals
        bm_ = bmesh.new()
        bm_.from_mesh(o.data)
        holes = sum(e.is_boundary for e in bm_.edges)  # open edges show as holes
        vol = bm_.calc_volume(signed=True)
        if holes or vol <= 0:
            print(f"  ! {o.name}: {holes} open edges, volume {vol:.5f}")
        bm_.free()

    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / "shards.glb"), export_format="GLB", use_selection=True,
                              export_apply=True, export_tangents=True, export_materials="EXPORT")

    if "--no-preview" not in args:
        preview(obs, mats, textured)


def preview(obs, mats, textured):
    """Exploded Cycles shot with the real bake on the outside, pale cuts inside."""
    h = max(o.location.z + max(v.co.z for v in o.data.vertices) for o in obs)
    for ob in obs:
        ob.data.materials[0] = textured
        d = ob.location - Vector((0, 0, h * 0.4))
        ob.location += Vector((d.x, d.y, d.z * 0.7)) * 0.45
    mats[1].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = kit.lin("#d9b48f")
    sc = bpy.context.scene
    w = bpy.data.worlds.new("w")
    sc.world = w
    g = kit.Graph(w)
    env = g("ShaderNodeTexEnvironment", image=kit.image(kit.ASSETS / "studio_kontrast_03.hdr", False))
    bg = g("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.35
    g.link(env.outputs["Color"], bg.inputs["Color"])
    g.link(bg.outputs["Background"], g("ShaderNodeOutputWorld").inputs["Surface"])
    for label, energy, loc in (("key", 90, (-1.6, -1.8, 2.2)), ("rim", 90, (1.9, 1.1, 1.3))):
        light = bpy.data.lights.new(label, "AREA")
        light.energy, light.size = energy, 1.0
        lo_ = kit.link(label, light)
        lo_.location = loc
        lo_.rotation_euler = (Vector((0, 0, 0.3)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam = kit.link("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    cam.location = Vector((0.35 * h, -2.3 * h - 0.6, 1.1 * h + 0.2))
    cam.rotation_euler = (Vector((0, 0, h * 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = 900
    sc.cycles.samples, sc.cycles.use_denoising = 64, True
    sc.render.filepath = str(out / "shards-preview.png")
    bpy.ops.render.render(write_still=True)


main()
