#!/bin/sh
# Build pieces in Blender and ship them to public/models.
#   npm run piece -- rook [knight …]
set -e
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
for p in "$@"; do
  "$BLENDER" -b --factory-startup -P blender/build.py -- "$p"
  for f in blender/out/"$p"/"$p"-*.glb; do
    npx gltf-transform optimize "$f" "public/models/$(basename "$f")" \
      --compress meshopt --texture-compress webp --simplify false
  done
done
ls -la public/models
