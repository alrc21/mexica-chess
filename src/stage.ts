import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import { advance, animating, easeInOut, tween } from './anim';
import { createAtmosphere, type Place } from './atmosphere';
import { createAudio, type Audio, type Loop } from './audio';
import { createBoard, squarePos, SLAB_TOP, type Board, type Hit, type Models } from './board';
import { createFire, type Fire } from './fire';
import { createJungle } from './jungle';
import { MODEL, STONE } from './lore';
import { createWalk, type Solid } from './walk';

type Stone = 'tezontle' | 'basalt' | 'cantera' | 'andesite';

/**
 * The bake carries the carving; a tiling grain normal carries the stone up
 * close, so the surface holds at any distance without bigger textures.
 * Scale is per asset (how much surface its UVs cover), strength per stone.
 */
const GRAIN_MAP: Record<Stone, 'tezontle' | 'basalt'> = { tezontle: 'tezontle', cantera: 'tezontle', basalt: 'basalt', andesite: 'basalt' };
const GRAIN_STRENGTH: Record<Stone, number> = { tezontle: 0.9, cantera: 0.6, basalt: 0.35, andesite: 0.5 };
// Contrast for play: red reads red, the dark squares sit between black basalt and pale cantera.
const TINT: Record<Stone, number> = { tezontle: 1.2, basalt: 1.0, cantera: 0.9, andesite: 1.45 };

function addGrain(mat: THREE.MeshStandardMaterial, map: THREE.Texture, scale: number, strength: number) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.grainMap = { value: map };
    shader.uniforms.grainScale = { value: scale };
    shader.uniforms.grainStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normalmap_pars_fragment>', `#include <normalmap_pars_fragment>
uniform sampler2D grainMap;
uniform float grainScale;
uniform float grainStrength;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
        'mapN.xy *= normalScale;',
        `mapN.xy *= normalScale;
	vec3 grainN = texture2D( grainMap, vNormalMapUv * grainScale ).xyz * 2.0 - 1.0;
	mapN = normalize( vec3( mapN.xy + grainN.xy * grainStrength, mapN.z ) );`,
      ));
  };
  mat.customProgramCacheKey = () => 'grain';
}

// Board space: files a–h run along +x, rank 1 is nearest +z (tezontle).
const BRAZIER = { scale: 2.2, inset: 6.8 };
const MONUMENT = { scale: 14, z: -27 };

type View = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
const V = (p: [number, number, number], l: [number, number, number], fov: number): View =>
  ({ pos: new THREE.Vector3(...p), look: new THREE.Vector3(...l), fov });

export type Stage = {
  board: Board;
  audio: Audio;
  /** Fly from wherever the camera is to a side's playing view. */
  toGame(side: Color): Promise<void>;
  /** Back to the slow drift in front of the Templo Mayor. */
  toIntro(): Promise<void>;
  /** Plays move number `ply`; a blow that matters gets a cut to a low, close camera. */
  play(move: Move, ply: number): Promise<void>;
  /** Checkmate: the king comes down, watched up close. */
  collapse(sq: Square, ply: number): Promise<void>;
  /** Down among the pieces on foot, or back up to the overview. */
  setWalking(on: boolean): Promise<void>;
  /** Night or day, as a slow change of the hour. */
  setDay(on: boolean): Promise<void>;
  /** Tenochtitlan or Calakmul: an instant swap, made behind the curtain. */
  setPlace(place: Place): void;
  setCursor(pointer: boolean): void;
  /** Where a square's centre lands on screen, in CSS pixels (used by the browser tests). */
  project(sq: Square, height?: number): { x: number; y: number };
};

export type StageEvents = {
  onReady(stage: Stage): void;
  /** A click on the board. Return true if the game used it; otherwise, on foot, we walk there. */
  onSquare(hit: Hit): boolean;
  onHover(hit: Hit): void;
};

export function createStage(canvas: HTMLCanvasElement, events: StageEvents) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Retina pixels are small enough to hide jaggies; low-density screens get MSAA instead.
  let dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // more bite than AgX: deep blacks, saturated oxide red
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 folded PCFSoft into PCF + radius
  renderer.shadowMap.autoUpdate = false; // re-rendered only while stone moves

  const scene = new THREE.Scene();
  const atmo = createAtmosphere(scene, renderer, MONUMENT.z);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 22;
  controls.maxPolarAngle = 1.32;
  controls.enabled = false;

  // ── Sound: opened by the first gesture, then the fire and the night begin ─
  const audio = createAudio();
  // Beds of sound per place and hour; only the matching one is heard.
  const ambience: Partial<Record<'night' | 'day' | 'jungleNight' | 'jungleDay' | 'wind', Loop | null>> = {};
  const fireSpots: THREE.Vector3[] = [];
  const mixAmbience = (seconds: number, k = atmo.state.k) => {
    const jungle = atmo.place === 'calakmul' ? 1 : 0;
    audio.fade(ambience.night ?? null, 0.5 * (1 - k) * (1 - jungle), seconds);
    audio.fade(ambience.day ?? null, 0.45 * k * (1 - jungle), seconds);
    audio.fade(ambience.jungleNight ?? null, 0.35 * (1 - k) * jungle, seconds); // the howlers carry: keep them far
    audio.fade(ambience.jungleDay ?? null, 0.5 * k * jungle, seconds);
    audio.fade(ambience.wind ?? null, 0.22 * jungle, seconds); // the summit stands in the wind
  };
  const unlock = () => {
    if (audio.started) return;
    audio.unlock();
    for (const p of fireSpots) audio.fade(audio.loop('fire-loop', p, 1.6), 0.6, 2);
    ambience.night = audio.loop('night-loop');
    ambience.day = audio.loop('day-loop');
    ambience.jungleNight = audio.loop('jungle-night-loop');
    ambience.jungleDay = audio.loop('jungle-day-loop');
    ambience.wind = audio.loop('wind-loop');
    mixAmbience(3);
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  // ── Textures ──────────────────────────────────────────────────────────────
  const textures = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tile = (url: string, repeat: number, color = false) => {
    const t = textures.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = aniso;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const grain = { tezontle: tile('/textures/grain-tezontle.jpg', 1), basalt: tile('/textures/grain-basalt.jpg', 1) };

  // ── Two places: the plaza of Tenochtitlan, and a summit above the forest of Calakmul ─
  const tenochtitlan = new THREE.Group();
  const calakmul = new THREE.Group();
  calakmul.visible = false;
  scene.add(tenochtitlan, calakmul);

  // ── Plaza: cut flagstones running into the haze ───────────────────────────
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      // Cut flagstones about a board square each, so the plaza and the board share a measure.
      map: tile('/textures/flagstone-diff.jpg', 100, true),
      normalMap: tile('/textures/flagstone-nor.jpg', 100),
      roughnessMap: tile('/textures/flagstone-rough.jpg', 100),
      color: '#6e655c',
      normalScale: new THREE.Vector2(1.5, 1.5),
    }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  const plazaMat = plaza.material as THREE.MeshStandardMaterial;
  tenochtitlan.add(plaza);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 8.1), new THREE.MeshStandardMaterial({ color: '#0d0b09', roughness: 1 }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.004;
  scene.add(bed);

  // ── Models ────────────────────────────────────────────────────────────────
  // Returns the glTF root: the mesh node inside keeps the scale/offset meshopt
  // quantisation stored on it; we only ever move the root.
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = async (name: string, stone: Stone, grainScale: number) => {
    const g = await gltf.loadAsync(`/models/${name}-${stone}.glb`);
    g.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.multiplyScalar(TINT[stone]);
      addGrain(mat, grain[GRAIN_MAP[stone]], grainScale, GRAIN_STRENGTH[stone]);
    });
    return g.scene;
  };
  const place = (src: THREE.Object3D, pos: THREE.Vector3, rotY = 0, scale = 1, parent: THREE.Object3D = scene) => {
    const m = src.clone();
    m.position.copy(pos);
    m.rotation.set(0, rotY, 0);
    m.scale.setScalar(scale);
    parent.add(m);
    return m;
  };

  // A fire's flames live in its place, but its light stays in the scene: hiding a
  // light would change every shader's light count and recompile them all.
  const fires: { fire: Fire; home: THREE.Object3D }[] = [];
  const light = (p: THREE.Vector3, scale: number, seed: number, home: THREE.Object3D = scene, lit = true, y = 0.8 * scale) => {
    const fire = createFire(seed, scale / 1.7, lit);
    fire.group.position.copy(p).setY(y);
    home.add(fire.group);
    if (fire.light) {
      fire.group.updateMatrixWorld(true);
      scene.attach(fire.light);
      fireSpots.push(fire.group.position);
    }
    fires.push({ fire, home });
  };
  const BRAZIERS: Solid[] = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => ({ x: sx * BRAZIER.inset, z: sz * BRAZIER.inset, r: 0.8 }));

  let board: Board | null = null;
  let disposed = false;
  let jungleUpdate: ((t: number, mist: THREE.Color) => void) | null = null;

  // ── Scars: a slab where a piece was destroyed is swapped for a broken one ─
  // Each square keeps a stack (intact, cracked, shattered) tagged by ply, so
  // Undo can take the damage back exactly.
  type Slab = { variant: number; stone: 'cantera' | 'andesite'; stack: { ply: number; obj: THREE.Object3D }[] };
  const slabs = new Map<Square, Slab>();
  let broken: (THREE.Object3D | null)[][] = []; // [variant][level-1], loaded after the first frame
  const interiorOf: Partial<Record<'cantera' | 'andesite', THREE.Material>> = {};
  const scar = (sq: Square, ply: number) => {
    const s = slabs.get(sq);
    const src = s && broken[s.variant]?.[s.stack.length - 1]; // intact → cracked → shattered
    if (!s || !src) return;
    const top = s.stack[s.stack.length - 1].obj;
    const exterior = (s.stack[0].obj.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    const obj = src.clone();
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = (m.material as THREE.Material).name === 'interior' ? interiorOf[s.stone]! : exterior;
      m.receiveShadow = true;
    });
    obj.position.copy(top.position);
    obj.rotation.copy(top.rotation);
    scene.add(obj);
    top.visible = false;
    s.stack.push({ ply, obj });
    renderer.shadowMap.needsUpdate = true;
  };
  const heal = (ply: number) => {
    for (const s of slabs.values()) {
      while (s.stack.length > 1 && s.stack[s.stack.length - 1].ply > ply) scene.remove(s.stack.pop()!.obj);
      s.stack[s.stack.length - 1].obj.visible = true;
    }
  };

  // ── Camera ────────────────────────────────────────────────────────────────
  // intro: a slow drift before the pyramid · orbit: the player's overview ·
  // walk: on foot · scripted: a tween owns the camera (flights, cinematics).
  const narrow = () => camera.aspect < 0.8;
  // Tenochtitlan: low before the Templo Mayor. Calakmul: over the board's shoulder,
  // out across the canopy to the great temple on the horizon.
  const INTRO = () => atmo.place === 'calakmul'
    ? (narrow() ? V([0, 3.4, 13], [0, -4, -170], 50) : V([0, 2.3, 10], [0, -4, -170], 34))
    : (narrow() ? V([0, 1.9, 9.5], [0, 5.2, MONUMENT.z], 48) : V([0, 1.35, 7.4], [0, 4.6, MONUMENT.z], 32));
  const GAME = (side: Color) => {
    const s = side === 'w' ? 1 : -1;
    return narrow() ? V([0, 17.2, 12.6 * s], [0, 0, 1.5 * s], 52) : V([0, 8.4, 11.2 * s], [0, 0, 1.25 * s], 30);
  };
  const WALK_FOV = () => (narrow() ? 74 : 62);
  let mode: 'intro' | 'orbit' | 'walk' | 'scripted' = 'intro';
  let walking = false;
  let side: Color = 'w';
  const look = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const setView = (v: View) => {
    camera.position.copy(v.pos);
    look.copy(v.look);
    camera.lookAt(look);
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
  };
  /** Where the camera is looking right now, whoever drives it. */
  const currentLook = () => {
    if (mode === 'orbit') return controls.target.clone();
    if (mode === 'walk') return camera.getWorldDirection(fwd).multiplyScalar(2).add(camera.position);
    return look.clone();
  };

  // Each camera command takes a new turn; an older flight or cinematic that
  // loses its turn stops touching the camera.
  let turn = 0;
  async function fly(to: View, dur: number, rise = 2.6) {
    const id = turn;
    const l0 = currentLook();
    mode = 'scripted';
    controls.enabled = false;
    const p0 = camera.position.clone();
    const f0 = camera.fov;
    const mid = p0.clone().lerp(to.pos, 0.5).add(new THREE.Vector3(0, rise, 0));
    const q = new THREE.Vector3();
    await tween(dur, k => {
      if (id !== turn) return;
      const e = easeInOut(k);
      q.copy(p0).multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(to.pos, e * e);
      camera.position.copy(q);
      look.lerpVectors(l0, to.look, e);
      camera.lookAt(look);
      camera.fov = f0 + (to.fov - f0) * e;
      camera.updateProjectionMatrix();
    });
  }
  const toOrbit = (v: View) => {
    controls.target.copy(v.look);
    controls.enabled = true;
    mode = 'orbit';
  };
  const setNear = (near: number) => { camera.near = near; camera.updateProjectionMatrix(); };

  const walk = createWalk(camera, () => [...(board?.solids() ?? []), ...BRAZIERS], (_at, run) => audio.play('step', { gain: run ? 0.55 : 0.4 }));
  async function walkIn() {
    const id = ++turn;
    const s = side === 'w' ? 1 : -1;
    const stand = new THREE.Vector3(0.5, 0, 0.6 * s); // between the armies
    const ahead = new THREE.Vector3(0.5, 0.55, -3.5 * s); // facing the enemy line
    setNear(0.02);
    await fly({ pos: walk.eyeAt(stand), look: ahead, fov: WALK_FOV() }, 2.2, 1.2);
    if (id !== turn) return;
    walk.place(stand, ahead);
    walk.start();
    mode = 'walk';
  }
  async function walkOut() {
    const id = ++turn;
    walk.stop();
    await fly(GAME(side), 2, 2.2);
    if (id !== turn) return;
    setNear(0.1);
    toOrbit(GAME(side));
  }

  // ── Blows: camera shake, a beat of slow motion, a flare of bloom ─────────
  let trauma = 0;
  let slowAt = -10;
  let flare = 0;
  let now = 0;
  const impact = (at: THREE.Vector3, power: number) => {
    const d = camera.position.distanceTo(at);
    trauma = Math.min(1, trauma + (power * 0.6) / (1 + d * 0.06));
    if (power >= 1) { slowAt = now; flare = 0.35; }
  };
  const timeScale = () => {
    const s = now - slowAt;
    return s > 1.05 ? 1 : 0.2 + 0.8 * THREE.MathUtils.smoothstep(s, 0.3, 1.05);
  };

  /**
   * A low witness camera on the blow. Tries a ring of angles around the
   * target and keeps the one with the fewest pieces in the way, preferring a
   * side-on view from the half of the board the player already looks from.
   */
  function witness(target: THREE.Vector3, along: THREE.Vector3, skip: THREE.Vector3[] = []): View {
    const far = narrow() ? 3.4 : 2.5;
    const eye = target.clone().setY(0.4);
    const sideways = new THREE.Vector3(-along.z, 0, along.x);
    if (sideways.dot(camera.position.clone().sub(target)) < 0) sideways.negate();
    const solids = (board?.solids() ?? []).filter(s => skip.every(k => Math.hypot(s.x - k.x, s.z - k.z) > 0.3));
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dir = sideways.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      for (const h of [0.9, 1.5]) {
        const pos = target.clone().addScaledVector(dir, far).setY(h);
        let blocked = 0;
        for (const s of solids) {
          // Closest approach of the sight line to the piece's axis, and the line's height there.
          const t = THREE.MathUtils.clamp(((s.x - pos.x) * (eye.x - pos.x) + (s.z - pos.z) * (eye.z - pos.z)) / (far * far), 0, 1);
          const x = pos.x + (eye.x - pos.x) * t, z = pos.z + (eye.z - pos.z) * t, y = pos.y + (eye.y - pos.y) * t;
          if (Math.hypot(x - s.x, z - s.z) < s.r + 0.1 && y < 1.1) blocked++;
        }
        const score = blocked * 10 + (1 - Math.cos(a)) * 1.5 + (h > 1 ? 0.6 : 0) + (Math.abs(pos.x) > 7 || Math.abs(pos.z) > 7 ? 5 : 0);
        if (score < bestScore) { bestScore = score; best = pos; }
      }
    }
    return { pos: best!, look: target.clone().add(new THREE.Vector3(0, 0.38, 0)), fov: narrow() ? 50 : 36 };
  }
  async function cinematic(focus: THREE.Vector3, along: THREE.Vector3, action: () => Promise<void>, lead = 0.25, skip: THREE.Vector3[] = []) {
    const back: View = { pos: camera.position.clone(), look: controls.target.clone(), fov: camera.fov };
    const id = ++turn;
    const flight = fly(witness(focus, along, skip), 0.8, 0.35);
    await tween(lead, () => {});
    await Promise.all([flight, action()]);
    await tween(0.8, () => {}); // watch the rubble
    if (id !== turn) return;
    await fly(back, 0.9, 0.3);
    if (id !== turn) return;
    toOrbit(back);
  }

  const stage: Stage = {
    get board() { return board!; },
    audio,
    async toGame(s) {
      const id = ++turn;
      side = s;
      walking = false;
      walk.stop();
      await fly(GAME(s), 2.8);
      if (id !== turn) return;
      setNear(0.1);
      toOrbit(GAME(s));
    },
    async toIntro() {
      const id = ++turn;
      walking = false;
      walk.stop();
      await fly(INTRO(), 2.4);
      if (id !== turn) return;
      setNear(0.1);
      mode = 'intro';
    },
    play(move, ply) {
      const b = board!;
      const big = !!move.captured && move.captured !== 'p';
      if (mode !== 'orbit' || !big) return b.play(move, ply);
      const to = squarePos(move.to as Square);
      const from = squarePos(move.from as Square);
      const along = to.clone().sub(from).setY(0).normalize();
      // The attacker's own path is not in the way: it's the subject.
      const path = [from, from.clone().lerp(to, 0.5), to];
      return cinematic(from.clone().lerp(to, 0.7), along, () => b.play(move, ply), 0.25, path);
    },
    collapse(sq, ply) {
      const b = board!;
      if (mode !== 'orbit') return b.collapse(sq, ply);
      const at = squarePos(sq);
      const along = new THREE.Vector3(0, 0, side === 'w' ? -1 : 1);
      return cinematic(at, along, () => b.collapse(sq, ply), 0.5, [at]);
    },
    async setWalking(on) {
      if (on === walking) return;
      walking = on;
      if (on) await walkIn(); else await walkOut();
    },
    async setDay(on) {
      const k0 = atmo.state.k;
      const k1 = on ? 1 : 0;
      mixAmbience(2.4, k1);
      await tween(2.6, k => atmo.set(k0 + (k1 - k0) * easeInOut(k)));
    },
    setPlace(p) {
      atmo.setPlace(p);
      tenochtitlan.visible = p === 'tenochtitlan';
      calakmul.visible = p === 'calakmul';
      board?.setEdge(p === 'calakmul' ? 10.5 : Infinity);
      mixAmbience(1.5);
      renderer.shadowMap.needsUpdate = true;
      if (mode === 'intro') setView(INTRO());
    },
    setCursor(pointer) { canvas.style.cursor = pointer ? 'pointer' : ''; },
    project(sq, height = 0) {
      const p = squarePos(sq);
      p.y += height;
      p.project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
    },
  };

  (async () => {
    const kinds = Object.keys(MODEL) as PieceSymbol[];
    const [pieces, slabModels, frame, corner, brazier, monument, precinct] = await Promise.all([
      Promise.all((['w', 'b'] as Color[]).map(c => Promise.all(kinds.map(k => load(MODEL[k], STONE[c], 9))))),
      Promise.all((['cantera', 'andesite'] as const).map(s => Promise.all([0, 1, 2].map(v => load(`slab${v}`, s, 4))))),
      load('frame', 'basalt', 7),
      load('corner', 'basalt', 5),
      load('brazier', 'basalt', 7),
      load('monument', 'tezontle', 9),
      (async () => {
        const [shrineCantera, shrineTezontle, roundTemple, altar, wall, corner] = await Promise.all([
          load('precinct/shrine', 'cantera', 24), load('precinct/shrine', 'tezontle', 24), load('precinct/round-temple', 'tezontle', 24),
          load('precinct/altar', 'cantera', 16), load('precinct/serpent-wall', 'basalt', 14), load('precinct/serpent-wall-corner', 'basalt', 8),
        ]);
        return { shrineCantera, shrineTezontle, roundTemple, altar, wall, corner };
      })(),
    ]);
    if (disposed) return;

    // Slabs: light squares in cantera, dark in andesite; variants and turns dealt by a fixed hash.
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const h = (f * 73 + r * 151 + f * r * 31) % 97;
        const light = (f + r) % 2 === 1;
        const obj = place(slabModels[light ? 0 : 1][h % 3], new THREE.Vector3(f - 3.5, 0, 3.5 - r), (h % 4) * Math.PI / 2);
        obj.traverse(o => { o.castShadow = false; }); // flat: nothing to cast
        slabs.set(`${String.fromCharCode(97 + f)}${r + 1}` as Square, { variant: h % 3, stone: light ? 'cantera' : 'andesite', stack: [{ ply: 0, obj }] });
      }
    }
    for (let k = 0; k < 4; k++) {
      const edge = new THREE.Group();
      edge.rotation.y = k * Math.PI / 2;
      for (const x of [-3, -1, 1, 3]) place(frame, new THREE.Vector3(x, 0, 4.25), 0, 1, edge);
      place(corner, new THREE.Vector3(4.3, 0, 4.25), 0, 1, edge);
      scene.add(edge);
    }
    BRAZIERS.forEach((b, i) => {
      const p = new THREE.Vector3(b.x, 0, b.z);
      place(brazier, p, i * 0.7, BRAZIER.scale);
      light(p, BRAZIER.scale, i * 1.37 + 0.4);
    });

    // The Templo Mayor itself, across the plaza, its stairs facing the board.
    place(monument, new THREE.Vector3(0, 0, MONUMENT.z), 0, MONUMENT.scale, tenochtitlan).traverse(o => { o.castShadow = false; });
    for (const sx of [-1, 1]) {
      const p = new THREE.Vector3(sx * 7.6, 0, MONUMENT.z + 7.8);
      place(brazier, p, sx, 3.2, tenochtitlan);
      light(p, 3.2, sx * 2.1 + 5, tenochtitlan);
    }

    // The sacred precinct: shrines flank the Templo Mayor, the round temple of
    // Ehecatl faces it from behind the player, low altars at the sides, and the
    // serpent wall closes the whole with a gate in the middle of each side.
    const facing = (x: number, z: number) => Math.atan2(-x, -z); // their fronts (+z) turned to the board
    const keep = (o: THREE.Object3D) => { o.traverse(c => { c.castShadow = false; }); return o; };
    for (const sx of [-1, 1]) {
      // Pale shrines close on the Templo Mayor's flanks (they frame it in the intro); red ones out to the sides.
      for (const [x, z, size, shrine] of [[12.5, -23, 5, precinct.shrineCantera], [24, -6, 4.6, precinct.shrineTezontle], [22, 18, 4.6, precinct.shrineCantera]] as const) {
        const at = new THREE.Vector3(sx * x, 0, z);
        const s = keep(place(shrine, at, facing(at.x, at.z), size, tenochtitlan));
        // A small fire on the landing before each shrine's door, seen across the plaza at night.
        light(new THREE.Vector3(0, 0, 0.36).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.rotation.y).multiplyScalar(size).add(at), size / 5, sx * 3 + z, tenochtitlan, false, 0.64 * size);
      }
      for (const sz of [-1, 1]) {
        const at = new THREE.Vector3(sx * 13, 0, sz * 7);
        keep(place(precinct.altar, at, facing(at.x, at.z), 3.6, tenochtitlan));
      }
    }
    keep(place(precinct.roundTemple, new THREE.Vector3(0, 0, 27), Math.PI, 5.2, tenochtitlan));
    // The coatepantli: instanced, one draw call for every segment.
    const W = 36, S = 3;
    const wallMesh = precinct.wall.getObjectByProperty('isMesh', true) as THREE.Mesh;
    precinct.wall.updateMatrixWorld(true);
    const segments: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [side, rot] of [[0, 0], [1, Math.PI], [2, -Math.PI / 2], [3, Math.PI / 2]] as const) {
      for (let i = 0; i < 12; i++) {
        if (i === 5 || i === 6) continue; // the gate
        const t = -W + 3 + i * 6;
        const pos = side < 2 ? new THREE.Vector3(t, 0, side === 0 ? -W : W) : new THREE.Vector3(side === 2 ? W : -W, 0, t);
        segments.push(m.compose(pos, q.setFromAxisAngle(up, rot), new THREE.Vector3(S, S, S)).clone().multiply(wallMesh.matrixWorld));
      }
    }
    const wall = new THREE.InstancedMesh(wallMesh.geometry, wallMesh.material, segments.length);
    segments.forEach((mat, i) => wall.setMatrixAt(i, mat));
    wall.receiveShadow = true;
    tenochtitlan.add(wall);
    for (const [x, z] of [[-W, -W], [W, -W], [-W, W], [W, W]]) keep(place(precinct.corner, new THREE.Vector3(x, 0, z), 0, S, tenochtitlan));

    // Calakmul: the summit, the canopy, the mist, the temples in the trees.
    const jungle = createJungle({
      map: tile('/textures/limestone-diff.jpg', 1, true), normal: tile('/textures/limestone-nor.jpg', 1), rough: tile('/textures/limestone-rough.jpg', 1),
      floor: { map: tile('/textures/flagstone-diff.jpg', 1, true), normal: tile('/textures/flagstone-nor.jpg', 1), rough: tile('/textures/flagstone-rough.jpg', 1) },
    });
    calakmul.add(jungle.group);
    jungleUpdate = jungle.update;

    const models = { w: {}, b: {} } as Models;
    (['w', 'b'] as Color[]).forEach((c, i) => kinds.forEach((k, j) => { models[c][k] = pieces[i][j]; }));
    board = createBoard(scene, models, (name, at, gain, rate) => audio.play(name, { at, gain, rate }), { impact, scar, heal });
    // Compile every shader now, behind the curtain, not on the first click.
    const warm = board.warmup();
    scene.add(...warm);
    renderer.compile(scene, camera);
    scene.remove(...warm);
    renderer.shadowMap.needsUpdate = true;
    events.onReady(stage);

    // The fractured pieces come after the first frame: nobody captures in the first seconds.
    const interior = {
      tezontle: new THREE.MeshStandardMaterial({ color: '#4f2218', roughness: 1, normalMap: grain.tezontle, normalScale: new THREE.Vector2(1.4, 1.4) }),
      basalt: new THREE.MeshStandardMaterial({ color: '#24221f', roughness: 0.88, normalMap: grain.basalt, normalScale: new THREE.Vector2(1, 1) }),
    };
    const shards = {} as Record<PieceSymbol, THREE.Object3D>;
    await Promise.all(kinds.map(async k => { shards[k] = (await gltf.loadAsync(`/models/shards/${MODEL[k]}.glb`)).scene; }));
    if (disposed) return;
    board.setShards(shards, interior);
    // Broken slabs (blender/damage.py): cracked and shattered, per variant. Missing files just mean no scars.
    interiorOf.cantera = new THREE.MeshStandardMaterial({ color: '#b9a98f', roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.8, 0.8) });
    interiorOf.andesite = new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: 0.9, normalMap: grain.basalt, normalScale: new THREE.Vector2(0.9, 0.9) });
    broken = await Promise.all([0, 1, 2].map(v => Promise.all([1, 2].map(l =>
      gltf.loadAsync(`/models/damage/slab${v}-${l}.glb`).then(g => g.scene, () => null)))));
    if (disposed) return;
    // Warm their programs (and instanced grit) without blocking a frame.
    const sample = shards.p.clone();
    const pieceMat = (pieces[0][0].getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    sample.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = (m.material as THREE.Material).name === 'interior' ? interior.tezontle : pieceMat; });
    const grit = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), pieceMat, 1);
    sample.position.y = -5;
    grit.position.y = -5;
    scene.add(sample, grit);
    await renderer.compileAsync(scene, camera);
    scene.remove(sample, grit);
  })();

  // ── Post: bloom only catches what burns ───────────────────────────────────
  // The composer's own target has no MSAA; give it one on low-density screens.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: dpr < 1.5 ? 4 : 0 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.3, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── Pointer: a click is a press that didn't become a drag ─────────────────
  // Orbit drags belong to OrbitControls; on foot a drag turns your head.
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; lx: number; ly: number; moved: number } | null = null;
  let hovered = '';
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB_TOP);
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0 };
    if (mode === 'walk') canvas.setPointerCapture(e.pointerId);
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || !board || (mode !== 'orbit' && mode !== 'walk')) return;
    if (d.moved > 6) return;
    toNdc(e);
    const used = events.onSquare(board.pick(ndc, camera));
    if (!used && mode === 'walk') {
      ray.setFromCamera(ndc, camera);
      const p = ray.ray.intersectPlane(ground, new THREE.Vector3());
      if (p) walk.walkTo(p);
    }
  };
  // Hover picks once per frame at most, however fast the trackpad reports.
  let hoverDirty = false;
  const onMove = (e: PointerEvent) => {
    if (down) {
      down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (mode === 'walk' && down.moved > 4) walk.look(e.clientX - down.lx, e.clientY - down.ly);
      down.lx = e.clientX;
      down.ly = e.clientY;
    }
    if (e.pointerType !== 'mouse') return;
    toNdc(e);
    hoverDirty = true;
  };
  const onLeave = () => { hovered = ''; events.onHover({ piece: null, ground: null }); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    if (mode === 'intro') setView(INTRO());
    if (mode === 'orbit') {
      const v = GAME(side);
      camera.fov = v.fov;
      controls.target.copy(v.look);
    }
    if (mode === 'walk') camera.fov = WALK_FOV();
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  // Dev: ?cam=x,y,z&look=x,y,z pins the camera for screenshots.
  const q = new URLSearchParams(location.search);
  const pin = q.get('cam')?.split(',').map(Number);
  if (pin?.length === 3) {
    mode = 'orbit';
    camera.position.set(pin[0], pin[1], pin[2]);
    controls.target.fromArray(q.get('look')?.split(',').map(Number) ?? [0, 0.3, 0]);
    controls.enabled = true;
  }

  // Adaptive resolution, judged only on quiet frames: a blow, a flight or a
  // shadow re-render is a moment, not the machine's pace. Too slow at rest →
  // fewer pixels; comfortably fast at rest → back toward full sharpness.
  const MAX_DPR = dpr;
  let pace = 1 / 60;
  let quiet = -3; // the first seconds after loading (compiles, uploads) don't count
  const adapt = (raw: number) => {
    pace = pace * 0.95 + raw * 0.05;
    if ((quiet += raw) < 3) return;
    quiet = 0;
    const next = pace > 1 / 40 ? Math.max(1, dpr - 0.25) : pace < 1 / 56 ? Math.min(MAX_DPR, dpr + 0.25) : dpr;
    if (next === dpr) return;
    dpr = next;
    console.info(`[stage] resolution ${dpr}x`);
    renderer.setPixelRatio(dpr);
    resize();
  };

  const MIST_DAY = new THREE.Color('#ebe6da'), MIST_NIGHT = new THREE.Color('#4d5b70'), mistColor = new THREE.Color();
  const shakePos = new THREE.Vector3();
  const shakeQuat = new THREE.Quaternion();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop(() => {
    timer.update();
    const raw = timer.getDelta();
    const real = Math.min(raw, 1 / 20);
    now += real;
    const dt = real * timeScale();
    const t = timer.getElapsed();
    advance(dt);
    const moving = board?.update(dt);
    const busy = moving || animating();
    if (busy) renderer.shadowMap.needsUpdate = true;
    if (board && !busy && !document.hidden) adapt(Math.min(raw, 0.1));
    else quiet = Math.min(quiet, 0); // a busy stretch restarts the quiet window
    if (hoverDirty && (mode === 'orbit' || mode === 'walk') && board) {
      hoverDirty = false;
      const hit = board.pick(ndc, camera);
      const key = `${hit.piece}${hit.ground}`;
      if (key !== hovered) { hovered = key; events.onHover(hit); }
    }
    if (mode === 'intro') {
      // A breath of movement: the camera sways and creeps toward the pyramid.
      const v = INTRO();
      camera.position.copy(v.pos).add(new THREE.Vector3(Math.sin(t * 0.09) * 0.9, Math.sin(t * 0.06) * 0.18, -Math.sin(t * 0.04) * 0.6));
      look.copy(v.look);
      camera.lookAt(look);
    } else if (mode === 'orbit') controls.update();
    else if (mode === 'walk') walk.update(real);

    const s = atmo.state;
    renderer.toneMappingExposure = s.exposure;
    flare *= Math.exp(-real * 3);
    bloom.strength = s.bloom + flare;
    for (const { fire, home } of fires) fire.update(t, camera, home.visible ? s.fire : 0, 1 - 0.3 * s.k);
    jungleUpdate?.(t, mistColor.copy(MIST_NIGHT).lerp(MIST_DAY, s.k));
    board?.setDustColor(s.dust);
    plazaMat.normalScale.setScalar(s.ground);
    plazaMat.color.copy(s.plaza);
    board?.setParticleScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    audio.listen(camera);

    // Shake rides on top of whatever drives the camera, and comes off after the frame.
    trauma = Math.max(0, trauma - real * 1.5);
    const amp = trauma * trauma;
    if (amp > 1e-4) {
      shakePos.copy(camera.position);
      shakeQuat.copy(camera.quaternion);
      const n = (f: number, o: number) => Math.sin(now * f + o) * 0.6 + Math.sin(now * f * 2.3 + o * 1.7) * 0.4;
      const reach = mode === 'walk' ? 0.012 : 0.06;
      camera.translateX(n(37, 0) * amp * reach);
      camera.translateY(n(41, 2) * amp * reach);
      camera.rotateZ(n(29, 5) * amp * 0.012);
      composer.render();
      camera.position.copy(shakePos);
      camera.quaternion.copy(shakeQuat);
    } else composer.render();
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    walk.stop();
    ro.disconnect();
    controls.dispose();
    composer.dispose();
    atmo.dispose();
    renderer.dispose();
  };
}
