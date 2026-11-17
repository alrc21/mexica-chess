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
import { MODEL, STONE, type Carving } from './lore';
import { createWalk, type Solid } from './walk';

type Stone = 'tezontle' | 'basalt' | 'cantera' | 'andesite' | 'limestone';

/**
 * The bake carries the carving; a tiling grain normal carries the stone up
 * close, so the surface holds at any distance without bigger textures.
 * Scale is per asset (how much surface its UVs cover), strength per stone.
 */
const GRAIN_MAP: Record<Stone, 'tezontle' | 'basalt'> = { tezontle: 'tezontle', cantera: 'tezontle', basalt: 'basalt', andesite: 'basalt', limestone: 'tezontle' };
const GRAIN_STRENGTH: Record<Stone, number> = { tezontle: 0.9, cantera: 0.6, basalt: 0.35, andesite: 0.5, limestone: 0.3 };
// Contrast for play: red reads red, the dark squares sit between black basalt and pale cantera.
const TINT: Record<Stone, number> = { tezontle: 1.2, basalt: 1.0, cantera: 0.9, andesite: 1.45, limestone: 1.0 };
/**
 * On the board the stone is lifted per object, measured on a phone's playing view (phase 10,
 * scripts/contrast.mjs): on screen black basalt < red tezontle < grey andesite < pale cantera,
 * about 1.8:1 between neighbours. Linear RGB in place of TINT, so the temple, shrines, braziers
 * and walls keep theirs. The red lifts mostly in its red channel (redder as it lightens), the
 * andesite a little toward blue (a cool grey), the frame off the black army.
 */
type RGB = [number, number, number];
const BOARD_TINT = {
  // Tezontle: a dusty oxide brick, a little more green than blue in it, not a pure red.
  piece: { tezontle: [5.2, 3.75, 2.3] as RGB, basalt: [0.7, 0.7, 0.7] as RGB },
  slab: { cantera: [1.5, 1.5, 1.5] as RGB, andesite: [7.35, 7.75, 8.6] as RGB },
  frame: [6, 6, 6] as RGB,
};
/** How far each lifted stone's colour is drawn toward its mean (addGrain): andesite's blotches, tezontle's printed-looking speckle. */
const BOARD_FLAT = { tezontle: 0.35, andesite: 0.65, frame: 0.6 };
/** What a board stone gained over its plain TINT: fresh breaks and slab interiors follow it. */
const lift = (hex: string, t: RGB, stone: Stone) => new THREE.Color(hex).multiply(new THREE.Color(...t).multiplyScalar(1 / TINT[stone]));

/**
 * What the pieces are carved in (phase 9a): volcanic stone, or the same pieces
 * in minerals — basalt's army in obsidian, tezontle's in amber or jade. A
 * polished bake keeps the carving and says how much stone each point has
 * behind it; the volume carries the colour, clearer at thin edges than in the
 * core. Thickness is in the mesh's own units (its node is scaled ~0.2–0.6);
 * attenuation in board units. Chosen in the intro; ?stone=amber|jade starts there.
 */
type Mineral = 'obsidian' | 'jade' | 'amber';
const STONE_PARAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('stone') : null;
export const FIRST_CARVING: Carving = STONE_PARAM === 'jade' || STONE_PARAM === 'amber' || STONE_PARAM === 'clay' ? STONE_PARAM : 'stone';
const MINERALS: Record<Mineral, THREE.MeshPhysicalMaterialParameters> = {
  obsidian: { color: '#1c1a18', transmission: 0.6, roughness: 0.05, ior: 1.49, attenuationColor: '#4a3a30', attenuationDistance: 0.2 }, // phase 10: dark against the lighter slabs and the frame
  // Phase 10: some of the light is the stone's own (its body holds a value against either square on a phone);
  // most still passes, brightest at the thin edges. The colour carries the mineral in the diffuse part.
  jade: { color: '#5a9673', transmission: 0.7, roughness: 0.32, ior: 1.66, attenuationColor: '#5cae7c', attenuationDistance: 0.4 },
  amber: { color: '#b07028', transmission: 0.7, roughness: 0.07, ior: 1.54, attenuationColor: '#e8a540', attenuationDistance: 0.55 },
};
/**
 * What shows through, read once: three filters it bicubically at two mip
 * levels (8 half-float taps a pixel, scattered by the refraction), the bulk of
 * each piece's cost. Polished stone sits at the bottom of the mip chain, where
 * one trilinear tap looks the same.
 */
const BICUBIC = 'return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );';
if (!THREE.ShaderChunk.transmission_pars_fragment.includes(BICUBIC)) console.warn('[stage] transmission chunk changed: minerals keep the bicubic read');
const ONE_TAP = THREE.ShaderChunk.transmission_pars_fragment.replace(BICUBIC, 'return textureLod( transmissionSamplerMap, fragCoord.xy, lod );');

/**
 * Clay (phase 11; raw since phase 12): the pieces and the board modelled and fired bare, bisque, no
 * glaze. Matte: the read is in the colour, not in what it mirrors (a glaze read as wet plastic on the
 * playing view). The carving keeps its polished cut (polish.py) under a tiling grain, the clay's grog;
 * the clay map (blender/glaze.py) washes the recesses darker (R: where dust and slip gather), lightens
 * the handled edges (G) and mottles the firing (B: clouds and runs, flashing; specks of grog at 0).
 * Bone clay against terracotta; the board in the same two clays with sandy joints, the rim a shade
 * below the pale tiles. Values for play on a phone (scripts/contrast.mjs): terracotta army <
 * terracotta tile < pale tile < bone army.
 */
type Clay = { color: string; wash: string; worn: string; speck: string; fire: number; specks: number; rough: number };
const CLAY = {
  w: { color: '#e2d9c8', wash: '#7d6f60', worn: '#efe7da', speck: '#6e5a48', fire: 0.26, specks: 0.55, rough: 0.9 },
  b: { color: '#6c2c19', wash: '#240c05', worn: '#8e4529', speck: '#2a0f07', fire: 0.5, specks: 0.6, rough: 0.92 },
  rim: { color: '#a1998c', wash: '#6e665b', worn: '#aea699', speck: '#5e4c3c', fire: 0.18, specks: 0.5, rough: 0.94 },
  light: { color: '#958879', wash: '#7d7163', worn: '#a19484', speck: '#5e4c3c', fire: 0.18, specks: 0.5, rough: 0.92 },
  dark: { color: '#8a5236', wash: '#6a3c26', worn: '#965c3c', speck: '#3e1e10', fire: 0.45, specks: 0.9, rough: 0.96 },
} satisfies Record<string, Clay>;
const JOINT = { color: '#8c7a5e', roughness: 1 }; // sandy joints: the bed shows in the seams (colour only: raised, it would cover the broken slabs' dish)
// × the contact shadow (board.ts): the bone army's draws its foot on the pale tile; under the terracotta it would pull the tile toward the piece
const CLAY_CONTACT = { w: 3, b: 0.5 };
const CLAY_BLOOM = 0.15; // × the bloom: bare clay doesn't burn; the fires still glow a little
const CLAY_PATCH: [string, string][] = [
  ['#include <map_pars_fragment>', `#include <map_pars_fragment>
uniform sampler2D clayMap;
uniform vec3 clayWash, clayWorn, claySpeck, clayMix;`],
  ['#include <color_fragment>', `#include <color_fragment>
	vec3 cm = texture2D( clayMap, vNormalMapUv ).rgb;
	float clayFire = clamp( ( cm.b - 0.25 ) / 0.75, 0.0, 1.0 ) - 0.5;
	float clayWashK = smoothstep( 0.02, 0.4, cm.r ), clayWornK = smoothstep( 0.15, 0.8, cm.g ) * ( 1.0 - clayWashK );
	diffuseColor.rgb *= 1.0 + clayMix.x * clayFire;
	diffuseColor.rgb = mix( diffuseColor.rgb, clayWorn, 0.6 * clayWornK );
	diffuseColor.rgb = mix( diffuseColor.rgb, clayWash, 0.85 * clayWashK );
	diffuseColor.rgb = mix( diffuseColor.rgb, claySpeck, ( 1.0 - smoothstep( 0.05, 0.18, cm.b ) ) * clayMix.y );`],
  // Matte, a little rougher in the wash and smoother where handled; the fine normal's own variance widens it
  // further (specular antialiasing), so no pixel can sparkle.
  ['#include <lights_physical_fragment>', `#include <lights_physical_fragment>
	vec3 clayDx = dFdx( normal ), clayDy = dFdy( normal );
	float clayVar = min( 2.0 * max( dot( clayDx, clayDx ), dot( clayDy, clayDy ) ), 0.25 );
	material.roughness = clamp( sqrt( pow( clayMix.z + 0.05 * clayFire + 0.06 * clayWashK - 0.08 * clayWornK, 2.0 ) + clayVar ), 0.6, 1.0 );`],
];
/** Bare clay on a material that has a normal map (the clay map shares its UVs), over its grain (addGrain first). */
function addClay(mat: THREE.MeshStandardMaterial, map: THREE.Texture, g: Clay) {
  const uniforms = {
    clayMap: { value: map }, clayWash: { value: new THREE.Color(g.wash) }, clayWorn: { value: new THREE.Color(g.worn) },
    claySpeck: { value: new THREE.Color(g.speck) }, clayMix: { value: new THREE.Vector3(g.fire, g.specks, g.rough) },
  };
  const grain = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    grain.call(mat, s, r);
    Object.assign(s.uniforms, uniforms);
    for (const [at, to] of CLAY_PATCH) {
      if (!s.fragmentShader.includes(at)) console.warn(`[stage] clay patch missed ${at}`);
      s.fragmentShader = s.fragmentShader.replace(at, to);
    }
  };
  mat.customProgramCacheKey = () => 'grain-clay';
}

/** The mean of a base-colour texture, linear (sRGB decoded), near-black atlas padding left out. */
function meanColour(tex: THREE.Texture) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.drawImage(tex.image as CanvasImageSource, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data, sum = new THREE.Color(0, 0, 0), px = new THREE.Color();
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] < 6) continue;
    sum.add(px.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace));
    n++;
  }
  return sum.multiplyScalar(1 / Math.max(n, 1));
}

/**
 * `flat` (0–1) draws the base colour toward its own mean before lighting: a dark texture lifted
 * several times over (phase 10) keeps its level but not its blotches; cracks and joints stay in
 * the normals and in what is left of the colour.
 */
function addGrain(mat: THREE.MeshStandardMaterial, map: THREE.Texture, scale: number, strength: number, flat = 0) {
  const mean = flat && mat.map ? meanColour(mat.map) : null;
  mat.onBeforeCompile = shader => {
    shader.uniforms.grainMap = { value: map };
    shader.uniforms.grainScale = { value: scale };
    shader.uniforms.grainStrength = { value: strength };
    if (mean) {
      shader.uniforms.albedoMean = { value: mean };
      shader.uniforms.albedoFlat = { value: flat };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
uniform vec3 albedoMean;
uniform float albedoFlat;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * albedoMean, albedoFlat );`);
    }
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
  mat.customProgramCacheKey = () => (mean ? 'grain-flat' : 'grain');
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
  /**
   * Plays move number `ply`; a blow that matters gets a cut to a low, close
   * camera. With `facing`, the camera ends up behind that side (two players
   * sharing a screen: the board turns to whoever moves next).
   */
  play(move: Move, ply: number, facing?: Color): Promise<void>;
  /** Turn around the board to a side's view (from the overview only). */
  face(side: Color): Promise<void>;
  /** Checkmate: the king comes down, watched up close. */
  collapse(sq: Square, ply: number): Promise<void>;
  /** Down among the pieces on foot, or back up to the overview. */
  setWalking(on: boolean): Promise<void>;
  /** Night or day, as a slow change of the hour. */
  setDay(on: boolean): Promise<void>;
  /** Tenochtitlan or Calakmul: an instant swap, made behind the curtain. */
  setPlace(place: Place): void;
  /** Stone, amber or jade: resolves once the new stone stands on the board (its shaders compiled first). */
  setStone(carving: Carving): Promise<void>;
  setCursor(pointer: boolean): void;
  /** Where a square's centre lands on screen, in CSS pixels (used by the browser tests). */
  project(sq: Square, height?: number): { x: number; y: number };
  /** Browser tests: hold the camera at `pos` looking at `look` (orbit controls stay live). */
  frame(pos: [number, number, number], look: [number, number, number], fov?: number): void;
};

export type StageEvents = {
  /** How much of what has been asked for has arrived (models, textures), 0–1; the total grows as loads begin. */
  onProgress?(loaded: number): void;
  onReady(stage: Stage): void;
  /** A click on the board. Return true if the game used it; otherwise, on foot, we walk there. */
  onSquare(hit: Hit): boolean;
  onHover(hit: Hit): void;
  /** A press on one of your own stones picks it up to drag; `fresh` when it wasn't already in hand. */
  onGrab(hit: Hit): { square: Square; fresh: boolean } | null;
  /** Let go of a dragged stone: true if it was played where it fell; otherwise it floats back. */
  onDrop(hit: Hit): boolean;
};

/**
 * Phones get a lighter stage: fewer pixels (the adaptive resolution still
 * watches from there), half-size shadow maps, a coarser forest, ground
 * textures at 1K. The stone itself — pieces, board, bakes — is the same.
 */
const PHONE_PARAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('phone') : null; // ?phone=1/0 to compare
export const PHONE = PHONE_PARAM ? PHONE_PARAM === '1'
  : typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

export function createStage(canvas: HTMLCanvasElement, events: StageEvents) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Retina pixels are small enough to hide jaggies; low-density screens get MSAA instead.
  let dpr = Math.min(window.devicePixelRatio, PHONE ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // more bite than AgX: deep blacks, saturated oxide red
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 folded PCFSoft into PCF + radius
  renderer.shadowMap.autoUpdate = false; // re-rendered only while stone moves

  const scene = new THREE.Scene();
  const atmo = createAtmosphere(scene, renderer, MONUMENT.z, PHONE ? 2048 : 4096);

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
  // Every texture and model goes through the default manager: that is the loader's progress.
  THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => events.onProgress?.(loaded / total);
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
  const FLAG = (m: 'diff' | 'nor' | 'rough') => `/textures/flagstone-${m}${PHONE ? '-1k' : ''}.jpg`;
  type Bake = { normal: THREE.Texture; thick: THREE.Texture; ao: THREE.Texture | null; normalScale: THREE.Vector2 };
  /**
   * A piece's mineral bake (blender/polish.py): its cuts polished instead of
   * worn, and how much stone lies behind each point. Both armies share one
   * sculpt and one set of UVs (and the shards keep them), so one bake fits all;
   * occlusion and the normal convention come from the stone it ships with.
   */
  const lend = (piece: string, mat: THREE.MeshStandardMaterial): Bake => {
    const map = (m: 'nor' | 'thick') => {
      const t = textures.load(`/textures/polish/${piece}-${m}.webp`);
      t.flipY = false; // glTF's UVs
      t.anisotropy = aniso;
      return t;
    };
    return { normal: map('nor'), thick: map('thick'), ao: mat.aoMap, normalScale: mat.normalScale.clone() };
  };
  /** A mineral body carved by `bake`. Without one: a fresh break. */
  const mineral = (kind: Mineral, bake?: Bake) => {
    const mat = new THREE.MeshPhysicalMaterial({
      transmission: 1, thickness: 0.9, specularIntensity: 1, ...MINERALS[kind],
      normalMap: bake?.normal ?? null, thicknessMap: bake?.thick ?? null, aoMap: bake?.ao ?? null,
    });
    if (bake) mat.normalScale.copy(bake.normalScale);
    mat.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <transmission_pars_fragment>', ONE_TAP); };
    mat.customProgramCacheKey = () => 'one-tap';
    return mat;
  };
  // ponytail: transmission costs ~13 ms a frame at 1728x1000@2 (~9 at @1) whatever the target's size, the far scene or the
  // texture filtering: ~4.5 ms for the pass, the rest per transmissive draw. Amber settles at 43 fps @1.5 where stone holds
  // 55 @2. Half the target is a small saving kept (stone has no transmissive draws: no pass); an alpha shell if it must run like stone
  renderer.transmissionResolutionScale = 0.5;

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
      map: tile(FLAG('diff'), 100, true),
      normalMap: tile(FLAG('nor'), 100),
      roughnessMap: tile(FLAG('rough'), 100),
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
  // Their textures come as <img>, like the plaza's, not as GLTFLoader's ImageBitmaps. After a lost WebGL
  // context three re-uploads every texture from its image; a bitmap that died with the context uploads
  // black, which is exactly a player's iPhone screenshot (board and pieces dark on a lit plaza, phase 10;
  // that iOS drops them is inferred). An <img> can also have its decoded pixels dropped and decoded again,
  // where ~180 bitmaps keep theirs for the whole session.
  // Phones get them at half size (1024² → 512², a quarter of the GPU memory): drawn once on a canvas that
  // goes straight back (iOS caps canvas memory), kept as a small <img> so a lost context can upload it again.
  // Safari can't write WebP (it would fall back to PNG, ~4× the bytes kept per texture): JPEG there; the stone is opaque.
  const HALF_TYPE = new URLSearchParams(location.search).get('half') !== 'jpeg' && document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'; // ?half=jpeg: Safari's branch, to test in Chrome
  const half = async (t: THREE.Texture) => {
    const img = t.image as HTMLImageElement;
    if (!(img instanceof HTMLImageElement) || img.width <= 512) return t; // a clone of one already halved
    await img.decode().catch(() => {}); // off the main thread, so drawing it is cheap
    const c = document.createElement('canvas');
    c.width = img.width >> 1;
    c.height = img.height >> 1;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, HALF_TYPE, 0.92));
    c.width = c.height = 0;
    if (!blob) return t;
    const small = new Image();
    small.src = URL.createObjectURL(blob);
    await small.decode().catch(() => {});
    URL.revokeObjectURL(small.src);
    t.image = small;
    t.needsUpdate = true;
    return t;
  };
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(parser => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    if (PHONE) {
      const source = parser.loadImageSource.bind(parser);
      parser.loadImageSource = (i, loader) => source(i, loader).then(half);
    }
    return { name: 'img-textures' };
  });
  const load = async (name: string, stone: Stone, grainScale: number, tint?: RGB, flat = 0) => {
    const g = await gltf.loadAsync(`/models/${name}-${stone}.glb`);
    g.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (tint) mat.color.multiply(new THREE.Color(...tint));
      else mat.color.multiplyScalar(TINT[stone]);
      addGrain(mat, grain[GRAIN_MAP[stone]], grainScale, GRAIN_STRENGTH[stone], flat);
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
  let setTemples: ((m: Record<'temple0' | 'temple1' | 'acropolis', THREE.Object3D>) => void) | null = null;
  let setCarving: ((s: Carving) => Promise<void>) | null = null;
  let carvedIn: Carving = 'stone';

  // ── Scars: a slab where a piece was destroyed is swapped for a broken one ─
  // Each square keeps a stack (intact, cracked, shattered) tagged by ply, so
  // Undo can take the damage back exactly.
  type Slab = { variant: number; stone: 'cantera' | 'andesite'; stack: { ply: number; obj: THREE.Object3D }[] };
  const slabs = new Map<Square, Slab>();
  let broken: (THREE.Object3D | null)[][] = []; // [variant][level-1], loaded after the first frame
  const interiorOf: Partial<Record<'cantera' | 'andesite', THREE.Material>> = {};
  /** A broken slab in this square's stone: the slab's own bake outside, fresh stone in the cuts. */
  const dress = (src: THREE.Object3D, s: Slab) => {
    const exterior = (s.stack[0].obj.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    const obj = src.clone();
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.cut = (m.material as THREE.Material).name === 'interior'; // a change of carving re-dresses it (carveIn)
      m.material = m.userData.cut ? interiorOf[s.stone]! : exterior;
      m.receiveShadow = m.castShadow = true; // the rim shades the plates sunk below it
    });
    return obj;
  };
  /**
   * The blow breaks the floor: the broken slab comes in looking whole (its
   * morph basis), then gives way — cracks open, plates drop into a dish,
   * overshoot and settle — and the bits it throws out of the crater are
   * handed back to the board to fly as rubble.
   */
  const scar = (sq: Square, ply: number, gain = 1): THREE.Object3D[] => {
    const s = slabs.get(sq);
    const src = s && broken[s.variant]?.[s.stack.length - 1]; // intact → cracked → shattered
    if (!s || !src) return [];
    const top = s.stack[s.stack.length - 1].obj;
    const obj = dress(src, s);
    obj.position.copy(top.position);
    obj.rotation.copy(top.rotation);
    scene.add(obj);
    top.visible = false;
    s.stack.push({ ply, obj });
    obj.updateMatrixWorld(true);
    const chips = obj.children.filter(c => c.name.startsWith('chip'));
    for (const c of chips) scene.attach(c);
    const plates: THREE.Mesh[] = [];
    obj.traverse(o => { const m = o as THREE.Mesh; if (m.morphTargetInfluences) plates.push(m); });
    tween(0.75, k => {
      const t = k * 0.75;
      const w = 1 - Math.exp(-t / 0.1) * Math.cos(t * Math.PI / 0.17);
      for (const m of plates) m.morphTargetInfluences![0] = w;
    });
    audio.play('slab', { at: obj.position, gain: 0.9 * gain });
    audio.play('dust', { at: obj.position, gain: 0.5 * gain, delay: 0.35 });
    renderer.shadowMap.needsUpdate = true;
    return chips;
  };
  /**
   * Takes the damage of moves after `ply` back. Over `dur` seconds the broken
   * slab rises level again — plates lift out of the dish, the cracks close —
   * while its bits fly back into the crater, then it's the whole slab.
   */
  const mending = new Set<THREE.Object3D>();
  const heal = (ply: number, dur = 0) => {
    for (const o of mending) scene.remove(o); // a mend under way ends at once
    mending.clear();
    for (const s of slabs.values()) {
      let top: THREE.Object3D | null = null;
      while (s.stack.length > 1 && s.stack[s.stack.length - 1].ply > ply) {
        const o = s.stack.pop()!.obj;
        if (dur && !top) top = o;
        else scene.remove(o);
      }
      const under = s.stack[s.stack.length - 1].obj;
      if (!top) { under.visible = true; continue; }
      const broken = top;
      mending.add(broken);
      const plates: THREE.Mesh[] = [];
      broken.traverse(o => { const m = o as THREE.Mesh; if (m.morphTargetInfluences) plates.push(m); });
      const w0 = plates[0]?.morphTargetInfluences![0] ?? 1;
      if (mending.size === 1) audio.play('slab', { gain: 0.35, rate: 0.75, delay: dur * 0.5 }); // one sound for the whole floor
      tween(dur, k => {
        if (!broken.parent) return; // taken back at once
        const e = easeInOut(k);
        for (const m of plates) m.morphTargetInfluences![0] = w0 * (1 - e);
        if (k === 1) { scene.remove(broken); mending.delete(broken); under.visible = true; }
      });
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
  let seatAz = 0; // where the fill and rim stand: they follow the seat round the board
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
  /**
   * Walk the camera round the board to `to`: azimuth, distance and height eased
   * together with a slight rise, eyes on the board — a turn, not a flip over the top.
   * A half turn always goes the same way round, like a turntable.
   */
  async function orbitTo(to: View, dur: number) {
    const id = turn;
    const l0 = currentLook();
    mode = 'scripted';
    controls.enabled = false;
    const p0 = camera.position.clone();
    const f0 = camera.fov;
    const a0 = Math.atan2(p0.x, p0.z);
    let da = Math.atan2(to.pos.x, to.pos.z) - a0;
    da = THREE.MathUtils.euclideanModulo(da + Math.PI, Math.PI * 2) - Math.PI;
    if (Math.abs(da) > Math.PI - 0.05) da = Math.PI;
    const r0 = Math.hypot(p0.x, p0.z), r1 = Math.hypot(to.pos.x, to.pos.z);
    await tween(dur, k => {
      if (id !== turn) return;
      const e = easeInOut(k);
      const a = a0 + da * e, r = r0 + (r1 - r0) * e;
      camera.position.set(Math.sin(a) * r, p0.y + (to.pos.y - p0.y) * e + Math.sin(Math.PI * e) * 1.1, Math.cos(a) * r);
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
  async function cinematic(focus: THREE.Vector3, along: THREE.Vector3, action: () => Promise<void>, lead = 0.25, skip: THREE.Vector3[] = [], back: View = { pos: camera.position.clone(), look: controls.target.clone(), fov: camera.fov }) {
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
      // Already over the board (a new game from the last): round to the side, eyes on the stone rebuilding.
      if (mode === 'orbit') await orbitTo(GAME(s), 2.2);
      else await fly(GAME(s), 2.8);
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
    async play(move, ply, facing) {
      const b = board!;
      const big = !!move.captured && move.captured !== 'p';
      const turning = !!facing && facing !== side && mode === 'orbit';
      if (mode !== 'orbit' || !big) {
        await b.play(move, ply);
        if (turning) await stage.face(facing!);
        return;
      }
      const to = squarePos(move.to as Square);
      const from = squarePos(move.from as Square);
      const along = to.clone().sub(from).setY(0).normalize();
      // The attacker's own path is not in the way: it's the subject.
      const path = [from, from.clone().lerp(to, 0.5), to];
      // Turning anyway: the cut comes back to the next player's side, not to where it left.
      if (turning) side = facing!;
      return cinematic(from.clone().lerp(to, 0.7), along, () => b.play(move, ply), 0.25, path, turning ? GAME(side) : undefined);
    },
    async face(s) {
      if (s === side || mode !== 'orbit') return;
      const id = ++turn;
      side = s;
      await orbitTo(GAME(s), 1.3);
      if (id !== turn) return;
      toOrbit(GAME(s));
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
    setStone: s => setCarving?.(s) ?? Promise.resolve(),
    setPlace(p) {
      atmo.setPlace(p);
      tenochtitlan.visible = p === 'tenochtitlan';
      calakmul.visible = p === 'calakmul';
      board?.setEdge(p === 'calakmul' ? 10.5 : Infinity);
      mixAmbience(1.5);
      renderer.shadowMap.needsUpdate = true;
      if (mode === 'intro') setView(INTRO());
    },
    setCursor(pointer) { canvas.style.cursor = grab?.dragging ? 'grabbing' : pointer ? 'pointer' : ''; },
    frame(pos, look, fov = camera.fov) {
      ++turn;
      setNear(0.02);
      setView(V(pos, look, fov));
      toOrbit(V(pos, look, fov));
    },
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
      Promise.all((['w', 'b'] as Color[]).map(c => Promise.all(kinds.map(k => load(MODEL[k], STONE[c], 9, BOARD_TINT.piece[STONE[c]], c === 'w' ? BOARD_FLAT.tezontle : 0))))),
      Promise.all((['cantera', 'andesite'] as const).map(s => Promise.all([0, 1, 2].map(v => load(`slab${v}`, s, 4, BOARD_TINT.slab[s], s === 'andesite' ? BOARD_FLAT.andesite : 0))))),
      load('frame', 'basalt', 7, BOARD_TINT.frame, BOARD_FLAT.frame),
      load('corner', 'basalt', 5, BOARD_TINT.frame, BOARD_FLAT.frame),
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
    const rim: THREE.Object3D[] = []; // the frame and its corners, re-dressed with the carving
    for (let k = 0; k < 4; k++) {
      const edge = new THREE.Group();
      edge.rotation.y = k * Math.PI / 2;
      for (const x of [-3, -1, 1, 3]) place(frame, new THREE.Vector3(x, 0, 4.25), 0, 1, edge);
      place(corner, new THREE.Vector3(4.3, 0, 4.25), 0, 1, edge);
      scene.add(edge);
      rim.push(edge);
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
      floor: { map: tile(FLAG('diff'), 1, true), normal: tile(FLAG('nor'), 1), rough: tile(FLAG('rough'), 1) },
    }, PHONE ? 300 : 560);
    calakmul.add(jungle.group);
    jungleUpdate = jungle.update;
    setTemples = jungle.setTemples;

    const models = { w: {}, b: {} } as Models;
    (['w', 'b'] as Color[]).forEach((c, i) => kinds.forEach((k, j) => { models[c][k] = pieces[i][j]; }));
    board = createBoard(scene, models, (name, at, gain, rate) => audio.play(name, { at, gain, rate }), { impact, scar, heal });

    // What each piece wears, per carving: its baked stone, or a mineral on the same bake (made the first time it's chosen).
    const meshOf = (o: THREE.Object3D) => o.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const stoneOf = new Map<THREE.Object3D, THREE.MeshStandardMaterial>(pieces.flat().map(o => [o, meshOf(o).material as THREE.MeshStandardMaterial]));
    const bakes = new Map<PieceSymbol, Bake>();
    const worn = new Map<string, THREE.Material>();

    // Clay (phase 11): every map loaded once (both armies share a sculpt and its UVs), halved on phones like the models' own.
    const glazed = new Map<string, THREE.Texture>();
    const glazeTex = (path: string) => {
      if (!glazed.has(path)) {
        const t = textures.load(`/textures/${path}.webp`, PHONE ? t => void half(t) : undefined);
        t.flipY = false; // glTF's UVs
        t.anisotropy = aniso;
        glazed.set(path, t);
      }
      return glazed.get(path)!;
    };
    /** Bare fired clay on a baked model: `normal` carries the carving, the grain the clay, occlusion from its stone bake. */
    const fired = (src: THREE.MeshStandardMaterial, normal: string, map: string, g: Clay, grainScale: number) => {
      const mat = new THREE.MeshStandardMaterial({ name: 'clay', color: g.color, roughness: g.rough, normalMap: glazeTex(normal), aoMap: src.aoMap });
      mat.normalScale.copy(src.normalScale);
      addGrain(mat, grain.tezontle, grainScale, 0.45);
      addClay(mat, glazeTex(map), g);
      return mat;
    };
    const clay = (c: Color, k: PieceSymbol) => fired(stoneOf.get(models[c][k])!, `polish/${MODEL[k]}-nor`, `glaze/${MODEL[k]}-glaze`, CLAY[c], 9);
    // The board in clay: the same slabs and UVs (so the broken ones still dress), as fired tiles; the rim in the pale clay; the bed as joints.
    const slabSrc = (stone: Slab['stone'], v: number) => meshOf(slabModels[stone === 'cantera' ? 0 : 1][v]).material as THREE.MeshStandardMaterial;
    const tiles = new Map<string, THREE.Material>();
    const tileOf = (stone: Slab['stone'], v: number, s: Carving): THREE.Material => {
      if (s !== 'clay') return slabSrc(stone, v);
      if (!tiles.has(stone + v)) {
        const mat = fired(slabSrc(stone, v), `glaze/slab${v}-nor`, `glaze/slab${v}-glaze`, stone === 'cantera' ? CLAY.light : CLAY.dark, 4);
        mat.name = `${stone}-clay`; // scripts/contrast.mjs tells the squares apart by it
        tiles.set(stone + v, mat);
      }
      return tiles.get(stone + v)!;
    };
    const rimSrc = { frame: meshOf(frame), corner: meshOf(corner) };
    const rims: Partial<Record<keyof typeof rimSrc, THREE.Material>> = {};
    const rimOf = (m: THREE.Mesh, s: Carving) => {
      const part = m.geometry === rimSrc.frame.geometry ? 'frame' : 'corner', src = rimSrc[part].material as THREE.MeshStandardMaterial;
      return s !== 'clay' ? src : rims[part] ??= fired(src, `glaze/${part}-nor`, `glaze/${part}-glaze`, CLAY.rim, 7);
    };
    const stoneCut: typeof interiorOf = {}; // filled once the broken slabs load
    let clayCuts: typeof interiorOf | null = null;
    const clayCut = () => clayCuts ??= { // fresh breaks: the same clays, a shade darker inside
      cantera: new THREE.MeshStandardMaterial({ color: '#d6b79c', roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true }),
      andesite: new THREE.MeshStandardMaterial({ color: '#94492a', roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true }),
    };
    const bedMat = bed.material as THREE.MeshStandardMaterial;
    const BED = { color: bedMat.color.clone(), roughness: bedMat.roughness };
    const dressBoard = (s: Carving) => {
      Object.assign(interiorOf, s === 'clay' ? clayCut() : stoneCut);
      for (const sl of slabs.values()) for (const { obj } of sl.stack) obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = m.userData.cut ? interiorOf[sl.stone]! : tileOf(sl.stone, sl.variant, s);
      });
      for (const e of rim) e.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = rimOf(m, s); });
      const b = s === 'clay' ? JOINT : BED;
      bedMat.color.set(b.color);
      bedMat.roughness = b.roughness;
    };

    const wear = (c: Color, k: PieceSymbol, s: Carving): THREE.Material => {
      if (s === 'stone') return stoneOf.get(models[c][k])!;
      const key = `${s}-${c}-${k}`;
      if (!worn.has(key)) {
        if (s !== 'clay' && !bakes.has(k)) bakes.set(k, lend(MODEL[k], stoneOf.get(models.b[k])!));
        worn.set(key, s === 'clay' ? clay(c, k) : mineral(c === 'b' ? 'obsidian' : s, bakes.get(k)));
      }
      return worn.get(key)!;
    };
    // A fresh break: raw stone, unglazed clay body, or the mineral without its bake.
    const breaks: Partial<Record<Carving, Record<'tezontle' | 'basalt', THREE.Material>>> = {};
    const breakOf = (s: Carving) => breaks[s] ??= s === 'stone' ? {
      tezontle: new THREE.MeshStandardMaterial({ color: lift('#4f2218', BOARD_TINT.piece.tezontle, 'tezontle'), roughness: 1, normalMap: grain.tezontle, normalScale: new THREE.Vector2(1.4, 1.4) }),
      basalt: new THREE.MeshStandardMaterial({ color: '#24221f', roughness: 0.88, normalMap: grain.basalt, normalScale: new THREE.Vector2(1, 1) }),
    } : s === 'clay' ? {
      tezontle: new THREE.MeshStandardMaterial({ color: '#dcbfa6', roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.7, 0.7) }),
      basalt: new THREE.MeshStandardMaterial({ color: '#7e3a1e', roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.9, 0.9) }),
    } : { tezontle: mineral(s), basalt: mineral('obsidian') };
    /** One of each board material a carving wears, for its warm-up (breaks and cuts included). */
    const boardWear = (s: Carving) => [
      ...([0, 1] as const).flatMap(i => [0, 1, 2].map(v => new THREE.Mesh(meshOf(slabModels[i][v]).geometry, tileOf(i ? 'andesite' : 'cantera', v, s)))),
      ...Object.values(rimSrc).map(m => new THREE.Mesh(m.geometry, rimOf(m, s))),
      ...[...Object.values(breakOf(s)), ...Object.values(s === 'clay' ? clayCut() : stoneCut)].map(m => new THREE.Mesh(rimSrc.corner.geometry, m!)),
      new THREE.InstancedMesh(rimSrc.corner.geometry, breakOf(s).tezontle, 1), // the crumbs
    ];
    let carving: Carving = 'stone';
    let shardSet: Record<PieceSymbol, THREE.Object3D> | null = null;
    const carveIn = (s: Carving) => {
      carving = carvedIn = s;
      for (const c of ['w', 'b'] as Color[]) for (const k of kinds) {
        meshOf(models[c][k]).material = wear(c, k, s);
        models[c][k].userData.contact = s === 'clay' ? CLAY_CONTACT[c]
          : s !== 'stone' && c === 'w' ? 0.45 : undefined; // light gets under amber and jade
      }
      dressBoard(s);
      board!.redress();
      if (shardSet) board!.setShards(shardSet, breakOf(s));
      renderer.shadowMap.needsUpdate = true;
    };
    setCarving = async s => {
      if (s === carving) return;
      // The new programs compile off-screen first, so the swap itself costs no frame.
      const samples = (['w', 'b'] as Color[]).flatMap(c => kinds.map(k => new THREE.Mesh(meshOf(models[c][k]).geometry, wear(c, k, s))));
      samples.push(...boardWear(s));
      for (const m of samples) m.position.y = -5;
      scene.add(...samples);
      await inComposer(() => renderer.compileAsync(scene, camera));
      scene.remove(...samples);
      if (!disposed) carveIn(s);
    };
    if (FIRST_CARVING !== 'stone') carveIn(FIRST_CARVING);

    // Compile every shader now, behind the curtain, not on the first click.
    const warm = board.warmup();
    scene.add(...warm);
    inComposer(() => renderer.compile(scene, camera));
    scene.remove(...warm);
    renderer.shadowMap.needsUpdate = true;
    audio.prepare();
    events.onReady(stage);

    // The fractured pieces come after the first frame: nobody captures in the first seconds.
    const shards = {} as Record<PieceSymbol, THREE.Object3D>;
    await Promise.all(kinds.map(async k => { shards[k] = (await gltf.loadAsync(`/models/shards/${MODEL[k]}.glb`)).scene; }));
    if (disposed) return;
    shardSet = shards;
    board.setShards(shards, breakOf(carving));
    // Broken slabs (blender/damage.py): cracked and shattered, per variant. Missing files just mean no scars.
    // Fresh cuts: pale at the lip, into shadow with depth (vertex colour baked by damage.py).
    stoneCut.cantera = new THREE.MeshStandardMaterial({ color: lift('#c4b498', BOARD_TINT.slab.cantera, 'cantera'), roughness: 0.95, normalMap: grain.tezontle, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true });
    stoneCut.andesite = new THREE.MeshStandardMaterial({ color: lift('#57544f', BOARD_TINT.slab.andesite, 'andesite'), roughness: 0.9, normalMap: grain.basalt, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true });
    Object.assign(interiorOf, (carving as Carving) === 'clay' ? clayCut() : stoneCut); // carveIn may have run since
    broken = await Promise.all([0, 1, 2].map(v => Promise.all([1, 2].map(l =>
      gltf.loadAsync(`/models/damage/slab${v}-${l}.glb`).then(g => g.scene, () => null)))));
    if (disposed) return;
    // Warm their programs (and instanced grit, and a broken slab) without blocking a frame.
    const sample = shards.p.clone();
    const pieceMat = (pieces[0][0].getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    sample.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = (m.material as THREE.Material).name === 'interior' ? breakOf(carving).tezontle : pieceMat; });
    const grit = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), breakOf(carving).tezontle, 1); // crumbs wear the break (rubble.ts)
    const samples: THREE.Object3D[] = [sample, grit];
    for (const stone of ['cantera', 'andesite'] as const) {
      const src = broken.flat().find(Boolean);
      const s = src && [...slabs.values()].find(x => x.stone === stone);
      if (src && s) samples.push(dress(src, s));
    }
    for (const o of samples) o.position.y = -5;
    scene.add(...samples);
    await inComposer(() => renderer.compileAsync(scene, camera));
    scene.remove(...samples);
    // The shadow pass draws crumbs (instanced) and sinking plates (morphs) with depth programs compile() never builds: their
    // twins, in a plain depth material with its side flipped as the shadow map flips it, against the scene's lights without
    // its fog (the shadow pass draws with none), link now and not at the first capture (scripts/jank.mjs).
    // Plates carry their face's map into the shadow (a stone slab has one, a clay tile and the cuts none): both twins.
    const depth = new THREE.MeshDepthMaterial({ side: THREE.BackSide }), mapped = new THREE.MeshDepthMaterial({ side: THREE.BackSide, map: grain.tezontle });
    const twins = new THREE.Scene(), plate = samples.slice(2).flatMap(o => o.getObjectsByProperty('isMesh', true) as THREE.Mesh[]).find(m => m.morphTargetInfluences);
    twins.add(new THREE.InstancedMesh(grit.geometry, depth, 1), ...(plate ? [depth, mapped].map(material => Object.assign(plate.clone(), { material })) : []));
    await inComposer(() => renderer.compileAsync(twins, camera, Object.create(scene, { fog: { value: null } })));

    // Calakmul's temples, from Blender: only that place shows them, so they come last.
    try {
      const [temple0, temple1, acropolis] = await Promise.all(['temple0', 'temple1', 'acropolis'].map(m => load(`maya/${m}`, 'limestone', 6)));
      if (!disposed) setTemples?.({ temple0, temple1, acropolis });
    } catch { /* no temples: the forest stands alone */ }
  })();

  // ── Post: bloom only catches what burns ───────────────────────────────────
  // The composer's own target has no MSAA; give it one on low-density screens.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: dpr < 1.5 ? 4 : 0 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.3, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Programs are keyed by where they draw: the scene goes into the composer's
  // buffer (linear, no tone mapping), so that's where the warm-up must compile.
  function inComposer<T>(f: () => T): T {
    renderer.setRenderTarget(composer.readBuffer);
    try { return f(); } finally { renderer.setRenderTarget(null); }
  }

  // ── Pointer: a click is a press that didn't become a drag ─────────────────
  // Orbit drags belong to OrbitControls, unless the press lands on one of your
  // own stones: then the drag carries it, and letting go plays it there. On
  // foot a drag turns your head.
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; lx: number; ly: number; moved: number } | null = null;
  let hovered = '';
  let rush = 1;
  let grab: { square: Square; fresh: boolean; orbit: boolean; dragging: boolean; pointer: number } | null = null;
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB_TOP);
  const onBoard = new THREE.Vector3();
  const onDown = (e: PointerEvent) => {
    if (grab) {
      if (e.pointerId !== grab.pointer) return; // a second finger while a stone is in hand
      // The same pointer pressing again: its release was lost. Put the stone back and start over.
      controls.enabled = grab.orbit;
      board?.hold(grab.square, null);
      grab = null;
    }
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0 };
    if (mode === 'walk') canvas.setPointerCapture(e.pointerId);
    if (mode === 'orbit' && board && e.button === 0) {
      toNdc(e);
      const g = events.onGrab(board.pick(ndc, camera));
      // OrbitControls saw the press first; switched off, it ignores the moves and still tidies up on release.
      // The release must reach us wherever the pointer goes: capture it ourselves.
      if (g) {
        grab = { ...g, orbit: controls.enabled, dragging: false, pointer: e.pointerId };
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      }
    }
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (grab) {
      const g = grab;
      grab = null;
      controls.enabled = g.orbit;
      if (g.dragging) {
        canvas.style.cursor = '';
        toNdc(e);
        const played = e.type !== 'pointercancel' && !!board && events.onDrop(board.pick(ndc, camera));
        if (!played) board?.hold(g.square, null);
        return;
      }
      if (g.fresh) return; // the press picked it up: letting go is not a second click
    }
    if (d && d.moved <= 6 && mode === 'scripted') rush = 3; // impatient: a click hurries the camera along
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
      if (grab && board && down.moved > 4) {
        grab.dragging = true;
        canvas.style.cursor = 'grabbing';
        toNdc(e);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(ground, onBoard)) board.hold(grab.square, onBoard);
      }
    }
    if (e.pointerType !== 'mouse' && !grab?.dragging) return; // a finger dragging a stone lights its landing too
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
  // A context given back is blank: three re-uploads textures and recompiles by itself, but the
  // shadow maps (re-rendered only on demand) and the environment (baked once) must be made again.
  const restored = () => { atmo.restore(); renderer.shadowMap.needsUpdate = true; };
  canvas.addEventListener('webglcontextrestored', restored);
  let lostFor = 0; // seconds on screen without a context

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
    // The browser never gave the context back: reload rather than leave a blank board, at most once a minute.
    // ponytail: the game in progress is lost (it lives only in memory); keep its moves in sessionStorage if that matters.
    lostFor = renderer.getContext().isContextLost() ? lostFor + real : 0;
    if (lostFor > 4 && Date.now() - Number(sessionStorage.getItem('mc-reload') ?? 0) > 60_000) {
      sessionStorage.setItem('mc-reload', String(Date.now()));
      renderer.setAnimationLoop(null);
      location.reload();
      return;
    }
    now += real;
    if (mode !== 'scripted') rush = 1;
    const dt = real * timeScale() * rush;
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
    // Fill and rim come round with the seat (positions only: nothing recompiles), so whoever plays sees the lit side.
    seatAz += ((side === 'w' ? 0 : Math.PI) - seatAz) * (1 - Math.exp(-real * 2.5));
    atmo.seat(seatAz);
    renderer.toneMappingExposure = s.exposure;
    flare *= Math.exp(-real * 3);
    bloom.strength = s.bloom * (carvedIn === 'clay' ? CLAY_BLOOM : 1) + flare;
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
    canvas.removeEventListener('webglcontextrestored', restored);
    walk.stop();
    ro.disconnect();
    controls.dispose();
    composer.dispose();
    atmo.dispose();
    renderer.dispose();
  };
}
