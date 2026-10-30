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
- [x] **6a. Responsive, two players, a floor that breaks.** The click hitch
  was shaders warmed for the screen but drawn into the composer's buffer (the
  first capture compiled them: a 416 ms freeze) and the tile shader recompiled
  on every selection; the hidden intro controls caught clicks over the lower
  left of the board. Now no shader links during play and no long tasks
  (`scripts/jank.mjs`). Two players: the board turns to whoever moves next; a
  click hurries a camera flight. The broken slab is a morph target: it comes in
  whole and gives way at the blow, its cuts dark with depth, the crater's bits
  thrown as rubble (`scripts/floor.mjs`).
- [x] **6b. Learn to play.** 26 lessons in five chapters on the real board
  (drills, rules, tactics, mates against the engine, strategy), each checked
  with chess.js and Stockfish (`scripts/lessons.mjs`); cacao per lesson, a
  rank, a streak and a codex of what you know, in localStorage
  (`scripts/learn.mjs`).
- [x] **6c. About and ship.** `/about` (a static second page), public repo,
  Vercel.
- [x] **7a. Grounded, lighter, Maya.** Contact shadows under every stone
  (`scripts/contact.mjs`). Phones: 1.5x pixels at most, 2K shadow maps, a
  coarser forest, 1K ground textures — ~40% cheaper per frame at a phone's
  viewport on the same GPU (`PHONE=1 node scripts/fps.mjs '…/?phone=1'`).
  Calakmul's temples carved in Blender (`blender/maya.py`,
  `blender/pieces/maya_*.py`, a Maya limestone in `kit.py`), loaded after the
  first frame. Licences: code MIT, art CC BY-NC 4.0. Commits under the
  GitHub noreply address (history rewritten).
- [x] **7b. Launch film.** 15 s, wide (1920×1080) and vertical (1080×1920),
  cut from real footage: the game recorded with its own clock slowed to 0.2×
  so no frame is dropped (180° motion blur in the edit), the rook turned in
  Blender from raw masses to sculpt to baked stone, the game's CC0 recordings
  for sound. The film and the posts live with the studio's files, not here.
- [x] **7c. The fall and the gathering.** Checkmate takes the whole army:
  after the king, each of his stones shudders, tips away from where he fell
  and breaks as it goes over (a soft burst: carried on along the fall, no kick
  upward), the slab under it cracks; the title waits for the dust. Undo and a
  new game run it backwards instead of popping: grit sinks, broken slabs rise
  level while their bits fly back into the crater, standing stones walk home,
  and each broken stone gathers itself out of its own rubble (chunks keep
  their rest pose; a piece rebuilt on another square is moved by
  `home · frame⁻¹`), from the plinth up; a crowned pawn taken back sinks. A
  new game from the last turns the camera round the board instead of flying
  over it. `scripts/fall.mjs` shoots it all with the page clock at 0.2×
  (`docs/evidence/phase7c-*`): no long tasks, 68 fps at 1440×900@2x in the
  fall.
- [x] **7d. Motion film.** 14 s, wide and vertical, replacing the launch
  film's stuck-on cards with type that lives in the scene: headlines that
  come in line by line, museum labels hung from one rail with a hairline to
  each stone (Ocelotl, Cuauhtli, Huey Tlatoani), the struck square marked in
  the capture red. The knight's blow, the names, the floor breaking, the
  army falling and gathering itself, Tenochtitlan to Calakmul. Recorded with
  the page clock at 0.2× while keeping the drawn camera per frame (so type is
  pinned to the stone afterwards) and every sound the game played (the mix
  is rebuilt from the game's own foley, in sync, at −14 LUFS). Scripts and
  films live with the studio's files, not here.
- [ ] **8. Next.** A real-iPhone pass; a phone download under 10 MB before
  play (phone-sized piece textures, the precinct after the first frame);
  KTX2 for VRAM (`scripts/ktx2.mjs` is ready); 2K stone on desktop.
- [x] **9a. Minerals.** The same pieces carved in precious stone
  of the Mexica world, after a smoked-and-clear acrylic set: basalt's army
  in obsidian (iztli, Tezcatlipoca's smoking mirror), tezontle's in jade
  (chalchihuitl, worth more than a load of gold to the envoys Bernal Díaz
  saw) or Chiapas amber (a true resin). Chosen in the intro — *Carved in:
  Stone · Amber · Jade*, swapped behind the place curtain once the new
  stone's shaders are compiled (no frame stalls in view); the armies take
  the stone's names (Amber/Obsidian, Jade/Obsidian) and the intro its line.
  `?stone=amber|jade` starts there. A `MeshPhysicalMaterial` with transmission lets
  the volume carry the colour; captures break into chunks of the same
  mineral; the contact shadow pales under jade and amber.
  First pass, on the stone bakes (`docs/evidence/phase9a-lookdev.jpg`,
  `scripts/lookdev.mjs`: columns stone, jade, amber; rows night, day, each
  army backlit, the board, two captures): tezontle's normals carry vesicles
  that polish turns into dents, so both armies took basalt's (one sculpt, one
  set of UVs). Obsidian was the smoked glass of the reference, best backlit;
  amber glowed backlit and far off but read as brass up close; jade read as
  green glass (its milkiness is scattering, which transmission doesn't do).
  **Kept: obsidian against amber** (2026-10-28, Alberto).
  The minerals' own bake (`blender/polish.py`, 6–7 s a piece once Cycles has
  its kernels): onto the game mesh as shipped — so the shards fit too — the
  same cuts sculpted again without weathering (`kit.sculpt(weather=False)`)
  and baked with no scans or vesicles: the carving a lapidary leaves; and a
  thickness map, occlusion seen from inside over a floor of 0.35, so thin
  edges run clear and the core holds the colour. 2.1 MB in
  `public/textures/polish/`, loaded the first time a mineral is chosen. Thickness 0.9: at
  1.5 amber turns to gold and obsidian to black; without the floor the fans
  and shields go colourless. `docs/evidence/phase9a-polish.jpg`: stone, amber
  on the stone bake, amber polished; night, day, both armies backlit.
  Left: shadow-map shadows under amber stay opaque; the sun on flat tops
  blooms hard; three lesson briefs say "Basalt" in any stone; the polished
  maps arrive after the swap (pieces may lack their carving for a moment);
  a fresh break has no thickness map, so it reads denser than the piece.
  Cost, measured at Alberto's screen (1728×1000@2, game view, uncapped,
  2026-10-29): it felt slow, and was — 6–17 fps at dpr 2 against stone's
  ~63. Earlier figures (82 → 43) were taken after adaptive resolution had
  already dropped the pixels, so they hid it. three draws the opaque scene
  again into a canvas-sized half-float 4×MSAA target, mipmapped every
  frame, then reads it bicubically at two mip levels (8 taps) per pixel.
  Kept: the target at half size, and one trilinear tap instead of the
  bicubic read (polish sits at the bottom of the mip chain). Now amber
  settles at 43 fps with resolution down to 1.5 where stone holds 55 at 2;
  with dpr frozen at 2, 35 against 65. Ruled out: the target's size (0.1
  to 0.5 within noise), the far scene (hiding it changes nothing), scattered
  reads (thickness 0 changes nothing), anisotropy, material switches. What
  is left — ~13 ms at @2, still ~9 at @1 — barely follows the pixels:
  ~4.5 ms for the pass, the rest per transmissive draw in three's path on
  ANGLE/Metal. An alpha shell (tint and thickness as opacity, reflections,
  no refraction) would cost what stone costs.
- [x] **9b. Drag and drop.** A press on one of your own stones picks it up
  and shows its moves; the drag carries it, floating after the pointer with
  weight (it trails and its top leans back from the travel), lifted over the
  head of any stone it passes, the square it would land on lit. Letting go
  on a legal square plays it from where it was let go — a capture rears back
  and lunges from over the victim (the blow now runs square to square, so a
  stone hanging over its target has a direction); anywhere else it floats
  back over its square, still in hand. Clicks are untouched: a press that
  doesn't travel is a click, and the press that picked a stone up isn't
  also a second click that puts it down. While a stone is carried the
  camera holds (OrbitControls switched off for that press, back on release);
  touch works the same; on foot a drag still turns your head. Anything that
  puts a stone down (a wrong move in a lesson, undo) floats it home.
  `scripts/drag.mjs`: a pawn each way, an illegal drop then a click, a
  capture dropped on the victim, the camera still while carrying, a finger
  on a phone — all pass; `click.mjs`, `learn.mjs` and `jank.mjs` unchanged.
- [x] **9c. Identity and loader.** Designed in Figma, *Mexica Chess — Brand
  & Loader* (figma.com/design/GldeOVybFtnT9yo36nKEuF): the six pieces as
  pictograms on a 24-unit grid, one plinth under every piece, the head
  telling them apart; the mark is Teocalli, the Templo Mayor's twin shrines
  split by the stair. Wordmark: Panchang Medium caps (Fontshare), in
  outline — the ITF Free Font License allows wordmarks and self-hosting
  but not the font file in a public repo, so `src/marks.ts` ships paths
  only. Stones named in Nahuatl: itztli, tezontli, apozonalli, chalchihuitl,
  tenextli. The loader (`src/Loader.tsx`) is the curtain: the temple rises
  in seven stages as the real one was rebuilt seven times, what is still to
  come drawn as a plan line; I–VI follow THREE.DefaultLoadingManager (every
  model and texture goes through it), VII waits for the compiled shaders,
  holds 0.7 s, dissolves into the intro and unmounts. The wordmark also
  titles the intro and the game header; `index.html` paints dark before
  the stylesheet. At 4 Mbps (dev): stages I–VI 4.2→6.4 s, VII at 8.4 s;
  bundle 295 KB gz. `drag.mjs` 9/9, `click.mjs` clean, `learn.mjs` 14/14,
  `jank.mjs` p95 16.8 ms. Open: a simplified mark for the favicon (below
  ~40 px the slot and doors close), the About page, the phone intro block
  over the temple.
- [x] **9d. The brand through the interface.** On a phone the intro's six
  choices covered the temple; now they fold into one line (stone · side ·
  level · hour — Change) and, opened, come one at a time, each pick
  bringing the next once its pill lands (a friend skips the level), the
  line folding again after the last with Play beneath — Alberto asked for
  it this minimal. The desktop keeps every choice in view. `Segmented`
  re-measures on a ResizeObserver, so its pill is right after display:none.
  Favicon: the mark redrawn for a 32 grid (three terraces, the stair, two
  shrines without doors), legible at 16 px. About: the wordmark in its
  header, and *02 · The mark* with the identity and glyph plates (sections
  renumbered to 08). `scripts/steps.mjs` walks the phone setup with real
  taps; drag, click, learn, play and jank unchanged.

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

- Name and domain (it ships as Mexica Chess on a vercel.app address).
- Who it is for and what it is for: a portfolio piece, a product, or both.

## Commands

```sh
python3 blender/fetch.py        # CC0 scans, once
npm run piece -- rook           # Blender bake → public/models (SHIP_ONLY=1 skips the bake)
npm run dev                     # http://localhost:3100
node scripts/shoot.mjs <dir> http://localhost:3100 /   # desktop + mobile shots
node scripts/click.mjs <dir>    # real clicks on projected squares (picking)
node scripts/drag.mjs <dir>     # drag and drop: by hand, an illegal drop, a capture, a finger on a phone
node scripts/steps.mjs <dir>    # the phone intro: choices folded, opened one at a time by tapping
node scripts/drama.mjs <dir>    # capture + mate, shot as a strip
node scripts/views.mjs <dir>    # intro/board by day, on foot by day and night
node scripts/fps.mjs            # uncapped fps: intro, game, on foot, day, Calakmul
node scripts/places.mjs <dir>   # both places, both hours: intro, board, on foot
node scripts/tiles.mjs <png>    # the tile close-up from the review, at retina scale
node scripts/jank.mjs           # frame gaps, long tasks and shader links around clicks and captures
node scripts/floor.mjs <dir>    # a square struck twice: mid-break, settled, up close
node scripts/lessons.mjs        # every lesson checked with chess.js and Stockfish
node scripts/learn.mjs <dir>    # learn end to end: drill, a miss, progress after reload, a hunt, phone
node scripts/about-shots.mjs    # clean frames for the About page → public/stills
node scripts/lookdev.mjs <dir> stone jade amber   # the same frames in stone and each mineral
blender -b --factory-startup -P blender/fracture.py -- king   # pre-fracture a piece
blender -b --factory-startup -P blender/polish.py -- king     # the minerals' bake: polished carving + thickness
```
