"""Build one piece end to end.

    blender -b --factory-startup -P blender/build.py -- rook [--res 2048] [--no-preview]
"""
import importlib, sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
res = int(args[args.index("--res") + 1]) if "--res" in args else 2048
piece = importlib.import_module(f"pieces.{name}")

t = time.time()
kit.reset()
out = kit.OUT / name
out.mkdir(parents=True, exist_ok=True)
solids, cutters = piece.build()
hi = kit.sculpt(solids, cutters, getattr(piece, "PROTECT", ()))
lo = kit.retopo(hi, piece.TRIS)
for stone in kit.STONES:
    maps = kit.bake(hi, lo, stone, res, out)
    kit.export(lo, name, kit.export_material(stone, maps), out / f"{name}-{stone}.glb")
    if "--no-preview" not in args:
        kit.preview(hi, lo, out / f"preview-{stone}.png")
print(f"done {name} in {time.time() - t:.0f}s")
