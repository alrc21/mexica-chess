"""Download the CC0 source scans (Poly Haven) the pieces are baked from.

    python3 blender/fetch.py
"""
import json, pathlib, urllib.request

ROOT = pathlib.Path(__file__).parent / "assets"
TEXTURES = {"rock_05": "2k", "dark_rock": "2k", "monastery_stone_floor": "2k", "large_grey_tiles": "2k", "mossy_sandstone": "2k"}  # tezontle, basalt, old plaza, flagstones, Maya limestone
MAPS = {"Diffuse": "diff", "nor_gl": "nor", "Rough": "rough", "Displacement": "disp"}
HDRIS = {"studio_kontrast_03": "1k", "fireplace": "1k"}


def fetch(url):
    # Poly Haven rejects urllib's default user agent.
    req = urllib.request.Request(url, headers={"User-Agent": "mexica-chess-build"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def get(url, dest):
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("↓", dest.relative_to(ROOT))
    dest.write_bytes(fetch(url))


def files(asset):
    return json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))


for asset, res in TEXTURES.items():
    f = files(asset)
    for key, short in MAPS.items():
        get(f[key][res]["jpg"]["url"], ROOT / asset / f"{short}.jpg")

for asset, res in HDRIS.items():
    get(files(asset)["hdri"][res]["hdr"]["url"], ROOT / f"{asset}.hdr")
