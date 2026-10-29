"""The minerals' bake (phase 9a): the carving without the stone.

    blender -b --factory-startup -P blender/polish.py -- king [--res 1024]

Bakes onto the game mesh as it shipped (blender/out/<piece>/<piece>-tezontle.glb,
the mesh fracture.py cut), so the maps fit the pieces and their shards alike:

  public/textures/polish/<piece>-nor.webp    the same cuts sculpted again, polished
      instead of worn: no scans, no vesicles, no weathering — what a lapidary leaves
  public/textures/polish/<piece>-thick.webp  how much stone lies behind each point
      (ambient occlusion seen from inside, over a floor): thin edges dark, the core light;
      three.js reads it as thicknessMap (green)
"""
import bpy, importlib, sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
res = int(args[args.index("--res") + 1]) if "--res" in args else 1024
piece = importlib.import_module(f"pieces.{name}")
dest = kit.HERE.parent / "public" / "textures" / "polish"
dest.mkdir(parents=True, exist_ok=True)
THICK = 0.3  # stone deeper than this reads as the core
FLOOR = 0.35  # the thinnest edge still counts this much of the core

t = time.time()
kit.reset()
bpy.ops.import_scene.gltf(filepath=str(kit.OUT / name / f"{name}-tezontle.glb"), merge_vertices=True)
lo = next(o for o in bpy.context.scene.objects if o.type == "MESH")
lo.data.transform(lo.matrix_world)
lo.matrix_world.identity()
solids, cutters = piece.build(getattr(piece, "SEEDS", [7])[0])
hi = kit.sculpt(solids, cutters, getattr(piece, "PROTECT", ()), seed=getattr(piece, "SEEDS", [7])[0], weather=False)
hi.data.materials.append(bpy.data.materials.new("plain"))

target = bpy.data.materials.new("bake")
lo.data.materials.clear()
lo.data.materials.append(target)
nodes, links = target.node_tree.nodes, target.node_tree.links
tex = nodes.new("ShaderNodeTexImage")
nodes.active = tex
sc = bpy.context.scene


def image(key):
    img = bpy.data.images.new(f"{name}_{key}", res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    tex.image = img
    return img


def save(img, key):
    img.filepath_raw = str(dest / f"{name}-{key}.webp")
    img.file_format = "WEBP"
    sc.render.image_settings.quality = 92
    img.save()
    print(f"  → {name}-{key}.webp")


# Normal: the polished sculpt projected onto the game mesh, as kit.bake does.
nor = image("nor")
for o in bpy.context.view_layer.objects:
    o.select_set(o in (hi, lo))
bpy.context.view_layer.objects.active = lo
sc.cycles.samples = 16
bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=0.01, max_ray_distance=0.03,
                    margin=16, use_clear=True)
save(nor, "nor")

# Thickness: the game mesh alone, occlusion looked for inside it.
thick = image("thick")
ao = nodes.new("ShaderNodeAmbientOcclusion")
ao.inside, ao.only_local, ao.samples = True, True, 32
ao.inputs["Distance"].default_value = THICK
floor = nodes.new("ShaderNodeMath")  # a thin leaf of amber is still pale honey, not clear glass
floor.operation = "MULTIPLY_ADD"
floor.inputs[1].default_value, floor.inputs[2].default_value = 1 - FLOOR, FLOOR
links.new(ao.outputs["AO"], floor.inputs[0])
emit = nodes.new("ShaderNodeEmission")
links.new(floor.outputs["Value"], emit.inputs["Color"])
links.new(emit.outputs["Emission"], nodes["Material Output"].inputs["Surface"])
for o in bpy.context.view_layer.objects:
    o.select_set(o is lo)
sc.cycles.samples = 64
bpy.ops.object.bake(type="EMIT", margin=16, use_clear=True)
save(thick, "thick")
print(f"done {name} in {time.time() - t:.0f}s")
