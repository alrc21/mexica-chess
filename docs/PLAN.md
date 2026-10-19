# Mexica Chess — plan

A playable 3D chess game in production on the web. Every piece is a carved
monolith built in Blender. The interface follows Curated Motions. All copy is
in English.

Working title: **Mexica Chess**. Before proposing a brand, check that the
domain is free.

## Decisions (2026-10-18)

| | Decision | Why |
|---|---|---|
| Pieces | Carved stone monoliths. Rook = the Templo Mayor (stepped pyramid, twin stairs, twin shrines); the others are steles carrying their tonalpohualli day-sign in relief (Ocelotl, Cuauhtli, Ollin…) | Mexica sculpture is blocky and frontal. A script can carry this direction to museum grade; figurative warriors would need generative 3D or a human sculptor |
| Sides | Red **tezontle** (matte, vesicular) against black **basalt** (matte, polished on the edges) | Raw stone, like the pyramid. The two sides differ in both colour and finish |
| Pipeline | Python scripts in `blender/`, run headless. Each piece is a voxel-remeshed sculpt of ~1.2M tris with carved boolean cuts, edge chips and noise. It is baked onto a ~17k-tri mesh (base, ORM, normal at 2K) and exported as GLB, then optimised with gltf-transform (meshopt + WebP) | Reproducible. A `.blend` file is never the source of truth |
| Up close | A tiling grain normal is mixed into the shader on top of the bake | The bake carries the carving, the grain carries the stone at any zoom |
| Light | A custom lightformer environment (dark, with two braziers, a sky strip and a rim) plus a near-neutral key light | A photographic HDRI washed the basalt out to grey or bronze |
| Interface | Curated Motions: `#0b0a08` / `#ece6da`, Funnel Display / Funnel Sans / Fragment Mono, plain type in the corners, the `cubic-bezier(.16,1,.3,1)` ease, a curtain transition | One studio, one hand |
| Stack | Vite + React + three.js. Rules come from chess.js, the opponent is Stockfish WASM in a worker, deployment on Vercel | |
| Sources | CC0 only: Poly Haven scans. Engine: Stockfish 19 lite (GPL-3.0, nmrugg/stockfish.js), shipped with its licence in `public/engine/` | The engine runs as a separate worker and talks UCI |

## Phases

Each phase ends with before/after screenshots in `docs/evidence/`.

- [x] **0. Vertical slice: the rook.** Blender → GLB → browser with the
  final look and chrome. Built in 85 s; 0.84–0.96 MB per piece.
  `docs/evidence/phase0-*`.
- [x] **1. The board.** 64 slabs in three carved variants, dealt with
  random turns: pale cantera for the light squares, grey andesite for the
  dark ones, with mortar joints and hairline cracks. The kerb is basalt with
  a running greca, and an Ollin block sits at each corner.
- [x] **2. The other five pieces, both sides.** King (quetzal fan,
  xiuhuitzolli, speech scroll), queen (quechquemitl, hair tufts, Ollin sun
  disk), bishop (eagle warrior, face in the beak), knight (jaguar warrior,
  face in the jaws), pawn (chimalli with its feather fringe). The backs are
  carved too, so the player's own army reads from behind.
- [x] **Pulled forward from 4: the night plaza.** Scanned flagstones running
  off into fog, four monumental basalt braziers with shader fire (flame
  tongues, embers, a breathing point light) and bloom that only catches the
  fire.
- [x] **3. The game.** chess.js rules; Stockfish 19 lite in a worker with
  three levels; two-player mode; pieces travel in an arc and lean into the
  move (the knight leaps); a capture bursts the victim into shards of its own
  stone with dust; castling, en passant, promotion with a picker, undo,
  check ring, game over. Hovering a piece names it. Touch: tap to select.
- [x] **Intro.** The Templo Mayor stands monumental across the plaza
  between two braziers; the camera drifts before it, then flies over the
  board on Play.
- [ ] **4. Polish.** The Templo Mayor on the horizon, stone-on-stone foley
  (CC0, not synthesised), KTX2 textures, LODs for the pawns, a performance
  pass on mobile, deployment.

## Budgets

- Download: under 15 MB of models (12 piece sets plus the board).
- Pieces: 13–20k tris each; pawns 10k (16 instances). About 750k tris in the full scene.
- Frame: 60 fps on an M-series laptop, 30+ fps on a recent iPhone.

## Open items (needs input)

- Name and domain.
- Optional references from Alberto: photos of stone and pieces he loves,
  and 2–3 3D sites he considers top tier.
- Who it is for and what it is for: a portfolio piece, a product, or both.

## Commands

```sh
python3 blender/fetch.py        # CC0 scans, once
npm run piece -- rook           # Blender bake → public/models (SHIP_ONLY=1 skips the bake)
npm run dev                     # http://localhost:3100
node scripts/shoot.mjs <dir> http://localhost:3100 /   # desktop + mobile shots
```
