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
- [x] **4a. Feel.** Picking by triangles, with a legal target on the ground
  beating the stone that hides it; whole-square path tiles that light up in a
  wave from the piece; selection allowed while the machine thinks; a click
  mid-animation is queued; stale engine replies discarded (they used to
  freeze the game after Undo); shadows re-rendered only while stone moves;
  shaders warmed behind the curtain; adaptive resolution.
- [x] **4b. Drama.** Pieces pre-fractured in Blender (`blender/fracture.py`)
  into convex chunks of their own baked mesh; a capture is an approach, a
  rear-back and a lunge, the victim breaks on contact into chunks that tumble,
  knock against the standing pieces and settle, with grit, sparks and dust;
  camera shake, a beat of slow motion and a bloom flare on every blow; a
  cinematic witness camera (the clearest of 32 angles) on major captures and
  the mate; the mated king trembles and comes down.
- [x] **4c. Sound.** CC0 field recordings (`public/audio/CREDITS.txt`):
  grinding, thuds, cracks, rubble, footsteps, fire, night and day ambience, a
  drum on check, a conch at the start and on mate. Spatial: the listener
  rides the camera.
- [x] **4d. Day and on foot.** Night/Day as a slow change of the hour (sun,
  sky, haze, Popocatépetl and Iztaccíhuatl on the skyline, the UI flips to
  ink). Walk the board at a person's eye height: drag to look, WASD or tap
  the ground, pieces and braziers are solid, and you can play from there.
- [x] **5a. Sharp and scarred.** The blur was adaptive resolution dropping
  during a capture and never coming back: it now judges quiet frames only and
  recovers. Path tiles redrawn as an even wash with hairline corner brackets.
  A slab where a piece is destroyed is swapped for a broken one (cracked,
  then shattered — `blender/damage.py`); chunks crumble to dust and the grit
  stays; Undo heals both. Golden-hour day; cut-flagstone plaza.
- [x] **5b. Two places.** Tenochtitlan's precinct (shrines, the round temple
  of Ehecatl, altars, the coatepantli — `blender/pieces/`) around the plaza.
  Calakmul: the board on a Maya summit above a rain forest drawn per pixel
  (two layers of crowns in relief near, painted far), mist, temples breaking
  through the trees, a moon by night; jungle, howlers and wind in the sound.
- [ ] **6. Ship.** KTX2 textures (`scripts/ktx2.mjs` is ready), the Maya
  temples modelled in Blender instead of blocks, a real-iPhone pass,
  deployment.

## Budgets

- Download: under 15 MB of models (12 piece sets plus the board).
- Pieces: 13–20k tris each; pawns 10k (16 instances). About 750k tris in the full scene.
- Frame: 60 fps on an M-series laptop, 30+ fps on a recent iPhone.
  Measured 2026-10-19, headless Chrome on Apple Silicon, 1440×900 @2x,
  vsync off: intro 112, game 83, on foot 113, on foot by day 115.
  2026-10-20, same rig, both places: intro 101, game 81, on foot 110–112,
  Calakmul game 75–77.
- Fractured pieces: 4.1 MB, loaded after the first frame.
- Sound: 1.7 MB, loaded on the first gesture.

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
node scripts/click.mjs <dir>    # real clicks on projected squares (picking)
node scripts/drama.mjs <dir>    # capture + mate, shot as a strip
node scripts/views.mjs <dir>    # intro/board by day, on foot by day and night
node scripts/fps.mjs            # uncapped fps: intro, game, on foot, day, Calakmul
node scripts/places.mjs <dir>   # both places, both hours: intro, board, on foot
node scripts/tiles.mjs <png>    # the tile close-up Alberto sent, at retina scale
blender -b --factory-startup -P blender/fracture.py -- king   # pre-fracture a piece
```
