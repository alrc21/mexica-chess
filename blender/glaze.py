"""The clay bake (phase 11; read as bare fired clay since phase 12): the carving dipped in a thick glaze.

Phase 12 dropped the glaze (it read as wet plastic): stage.ts reads the same maps as raw clay, R as the
dark wash in the recesses, G as the handled edges, B as the firing mottle and grog specks; pieces take
polish.py's normal, slabs and the frame keep the dipped one below.

    blender -b --factory-startup -P blender/glaze.py -- king [--res 1024]     (pieces, frame, corner, slab)

Bakes onto the game mesh as it shipped (blender/out/<name>/<name>-<first stone>.glb; slabs:
every variant), so the maps fit the pieces, their shards and the broken slabs alike:

  public/textures/glaze/<name>-nor.webp   the sculpt unweathered, then dipped: a coarser remesh
      and a smoothing fill the finest cuts and round every edge, a slow wobble says it was
      glazed by hand (slabs: no cracks, a pillowed top). three.js puts it under the body and the
      clear coat both: the sharp polish.py normal under an opaque glaze read as machined.
  Every piece, the frame, the corner and the slab: ~4 min run side by side (10–60 s alone).
  public/textures/glaze/<name>-glaze.webp  R where the glaze pools (occlusion outside, short),
      G where it runs thin (occlusion inside: short at the edges, half-weight over broad shoulders),
      B a mottle in object space, no seams: clouds and downward runs in 0.25–1, iron specks at 0.
"""
import bpy, bmesh, importlib, sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
res = int(args[args.index("--res") + 1]) if "--res" in args else 1024
piece = importlib.import_module(f"pieces.{name}")
dest = kit.HERE.parent / "public" / "textures" / "glaze"
dest.mkdir(parents=True, exist_ok=True)
seeds = getattr(piece, "SEEDS", [7])
stone = getattr(piece, "STONES", ["tezontle"])[0]
SLAB = name == "slab"
DIP = 3.0  # the dipped remesh, in sculpt voxels: cuts narrower than this fill with glaze
POOL, THIN, BROAD = 0.035, 0.025, 0.08  # occlusion distances (mesh units; a plinth is 0.76 wide)
PILLOW = 0.004  # a slab's top rises this much at its centre

def dipped(hi, seed):
    lo = kit.link("dip", hi.data.copy())
    if SLAB:  # a hand-pressed tile: the top swells toward the middle, unevenly
        bm = bmesh.new()
        bm.from_mesh(lo.data)
        for v in bm.verts:
            if v.co.z > 0.03:
                x, y = v.co.x / 0.493, v.co.y / 0.493
                v.co.z += PILLOW * max(0.0, 1 - x ** 4) * max(0.0, 1 - y ** 4) * (1 + 0.25 * x + 0.15 * y)
        bm.to_mesh(lo.data)
        bm.free()
    m = lo.modifiers.new("dip", "REMESH")
    m.mode, m.voxel_size = "VOXEL", 0.0022 * DIP
    s = lo.modifiers.new("run", "SMOOTH")
    s.factor, s.iterations = 0.7, 6
    d = lo.modifiers.new("hand", "DISPLACE")
    d.texture, d.texture_coords, d.strength = kit.noise_tex("CLOUDS", 0.07 + 0.01 * (seed % 5)), "LOCAL", 0.008
    kit.apply_modifiers(lo)
    for p in lo.data.polygons:
        p.use_smooth = True
    return lo


def image(key, tex):
    img = bpy.data.images.new(f"{name}_{key}", res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    tex.image = img
    return img


def save(img, path, quality=90):
    bpy.context.scene.render.image_settings.quality = quality
    img.filepath_raw = str(path)
    img.file_format = "WEBP"
    img.save()
    print(f"  → {path.name}")


def bake_from(src, lo, kind, **kw):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (src, lo))
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.01, max_ray_distance=0.03,
                        margin=16, use_clear=True, **kw)


def pack_material(seed):
    """Emission = (pool, thin, mottle), read on the sculpt."""
    mat = bpy.data.materials.new("pack")
    g = kit.Graph(mat)
    pool = g("ShaderNodeAmbientOcclusion", only_local=True, samples=32)
    pool.inputs["Distance"].default_value = POOL
    thin = g("ShaderNodeAmbientOcclusion", only_local=True, inside=True, samples=32)
    thin.inputs["Distance"].default_value = THIN
    broad = g("ShaderNodeAmbientOcclusion", only_local=True, inside=True, samples=32)  # the glaze thins over whole shoulders too
    broad.inputs["Distance"].default_value = BROAD
    coord = g("ShaderNodeTexCoord")
    cloud = g("ShaderNodeTexNoise")
    cloud.inputs["Scale"].default_value = 7.0 + seed % 3
    cloud.inputs["Detail"].default_value = 4
    g.link(coord.outputs["Object"], cloud.inputs["Vector"])
    run = g("ShaderNodeMapping")  # runs: noise stretched down the piece (object Z), as glaze sags while it fires
    run.inputs["Scale"].default_value = (26.0, 26.0, 2.2)
    g.link(coord.outputs["Object"], run.inputs["Vector"])
    runs = g("ShaderNodeTexNoise")
    runs.inputs["Scale"].default_value = 1.0
    runs.inputs["Detail"].default_value = 3
    g.link(run.outputs["Vector"], runs.inputs["Vector"])
    speck = g("ShaderNodeTexNoise")
    speck.inputs["Scale"].default_value = 60.0 if SLAB else 140.0  # a tile is seen from further off
    speck.inputs["Detail"].default_value = 1
    g.link(coord.outputs["Object"], speck.inputs["Vector"])
    # mottle = 0.25 + 0.75·cloud, specks (the noise's top tail) pushed to 0
    def math(op, a, b=None, c=None):
        n = g("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                g.link(v, n.inputs[i])
        return n.outputs[0]
    blend = math("MULTIPLY_ADD", runs.outputs["Fac"], 0.5, math("MULTIPLY", cloud.outputs["Fac"], 0.5))
    stretch = math("MULTIPLY_ADD", math("SUBTRACT", blend, 0.3), 1.9, 0.0)  # noise sits in ~0.3–0.7
    mottle = math("MULTIPLY_ADD", math("MINIMUM", math("MAXIMUM", stretch, 0.0), 1.0), 0.75, 0.25)
    dots = math("GREATER_THAN", speck.outputs["Fac"], 0.66)
    mottle = math("MULTIPLY", mottle, math("SUBTRACT", 1.0, dots))
    rgb = g("ShaderNodeCombineColor")
    g.link(math("SUBTRACT", 1.0, pool.outputs["AO"]), rgb.inputs["Red"])
    g.link(math("SUBTRACT", 1.0, math("MULTIPLY", thin.outputs["AO"], math("MULTIPLY_ADD", broad.outputs["AO"], 0.5, 0.5))), rgb.inputs["Green"])
    g.link(mottle, rgb.inputs["Blue"])
    emit = g("ShaderNodeEmission")
    g.link(rgb.outputs["Color"], emit.inputs["Color"])
    out = g("ShaderNodeOutputMaterial")
    g.link(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


t = time.time()
for v, seed in enumerate(seeds):
    tag = f"{name}{v}" if len(seeds) > 1 else name
    kit.reset()
    sc = bpy.context.scene
    sc.render.image_settings.quality = 90
    bpy.ops.import_scene.gltf(filepath=str(kit.OUT / name / f"{tag}-{stone}.glb"), merge_vertices=True)
    lo = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    lo.data.transform(lo.matrix_world)
    lo.matrix_world.identity()
    solids, cutters = piece.build(seed)
    if SLAB:  # a tile, not a cracked paving stone
        kit.remove(cutters)
        cutters = []
    hi = kit.sculpt(solids, cutters, getattr(piece, "PROTECT", ()), seed=seed, weather=False)
    dip = dipped(hi, seed)
    sc.cycles.samples = 16
    target = bpy.data.materials.new("bake")
    lo.data.materials.clear()
    lo.data.materials.append(target)
    tex = target.node_tree.nodes.new("ShaderNodeTexImage")
    target.node_tree.nodes.active = tex

    nor = image("nor", tex)
    dip.data.materials.append(bpy.data.materials.new("plain"))
    bake_from(dip, lo, "NORMAL")
    save(nor, dest / f"{tag}-nor.webp")

    pack = image("glaze", tex)
    src = dip if SLAB else hi  # pieces: the glaze pools in the carving's own cuts
    src.data.materials.clear()
    src.data.materials.append(pack_material(seed))
    sc.cycles.samples = 48
    bake_from(src, lo, "EMIT")
    save(pack, dest / f"{tag}-glaze.webp", 80)
print(f"done {name} in {time.time() - t:.0f}s")
