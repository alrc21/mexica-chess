"""Build one piece end to end.

    blender -b --factory-startup -P blender/build.py -- rook [--res 2048] [--no-preview]

A piece module defines build(seed) -> (solids, cutters) and TRIS; optionally
STONES (which stones to bake), SEEDS (variants: name0, name1…), RES, PROTECT.
"""
import importlib, sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kit

args = sys.argv[sys.argv.index("--") + 1:]
name = args[0]
piece = importlib.import_module(f"pieces.{name}")
res = int(args[args.index("--res") + 1]) if "--res" in args else getattr(piece, "RES", 2048)
stones = getattr(piece, "STONES", ["tezontle", "basalt"])
seeds = getattr(piece, "SEEDS", [7])

t = time.time()
for v, seed in enumerate(seeds):
    tag = f"{name}{v}" if len(seeds) > 1 else name
    kit.reset()
    out = kit.OUT / name
    out.mkdir(parents=True, exist_ok=True)
    solids, cutters = piece.build(seed)
    hi = kit.sculpt(solids, cutters, getattr(piece, "PROTECT", ()), seed=seed)
    lo = kit.retopo(hi, piece.TRIS)
    for stone in stones:
        maps = kit.bake(hi, lo, stone, res, out)
        kit.export(lo, tag, kit.export_material(stone, maps), out / f"{tag}-{stone}.glb")
        if "--no-preview" not in args:
            kit.preview(hi, lo, out / f"preview-{tag}-{stone}.png")
print(f"done {name} in {time.time() - t:.0f}s")
