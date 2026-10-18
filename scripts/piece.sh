#!/bin/sh
# Build pieces in Blender and ship them to public/models.
#   npm run piece -- rook [knight …]      SHIP_ONLY=1 skips the bake
#   SIZE=2048 for full-resolution textures (default 1024: 12 sets fit in VRAM)
set -e
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
for p in "$@"; do
  [ -n "$SHIP_ONLY" ] || "$BLENDER" -b --factory-startup -P blender/build.py -- "$p" --no-preview
  for f in blender/out/"$p"/"$p"*-*.glb; do
    npx gltf-transform optimize "$f" "public/models/$(basename "$f")" \
      --compress meshopt --texture-compress webp --texture-size "${SIZE:-1024}" --simplify false >/dev/null
  done
done
ls -la public/models
