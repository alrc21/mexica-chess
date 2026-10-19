import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { advance, animating, easeInOut, tween } from './anim';
import { createBoard, squarePos, type Board, type Hit, type Models } from './board';
import { createFire, type Fire } from './fire';
import { MODEL, STONE } from './lore';

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

/**
 * What the stone reflects: near-black with a few light cards — braziers, a
 * dim strip of night sky, a rim. Burnished basalt reads black with clean
 * highlights instead of mirroring a bright photo studio.
 */
function lightformers() {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#030303');
  const card = (color: string, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  card('#ff9447', 7, 1.2, 1.6, -4, 1.2, 2.6);
  card('#ff8236', 3, 1.0, 1.2, 4.6, 0.8, -2.2);
  card('#efe6da', 0.9, 7, 1.2, 0, 6, 0);
  card('#f3ece4', 2.2, 3.2, 0.5, 2.2, 2.4, -5);
  return env;
}

const HORIZON = '#100d0b';

/** Night sky: a warm haze at the horizon going black overhead, a few faint stars. */
function sky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uHorizon: { value: new THREE.Color(HORIZON) } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = mix(uHorizon, vec3(0.006, 0.006, 0.007), smoothstep(-0.02, 0.45, d.y));
          vec2 g = vec2(atan(d.z, d.x) * 140.0, d.y * 140.0);
          vec2 cell = floor(g);
          vec2 at = vec2(hash(cell), hash(cell + 7.3));
          float star = step(0.986, hash(cell + 3.1)) * smoothstep(0.32, 0.0, length(fract(g) - at));
          c += vec3(0.75, 0.72, 0.66) * star * smoothstep(0.08, 0.4, d.y) * (0.35 + 0.65 * hash(cell + 9.1));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
}

// Board space: files a–h run along +x, rank 1 is nearest +z (tezontle).
const at = (file: number, rank: number) => new THREE.Vector3(file - 3.5, 0, 3.5 - rank);
const BRAZIER = { scale: 2.2, inset: 6.8 };
const MONUMENT = { scale: 14, z: -27 };

type View = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
const V = (p: [number, number, number], l: [number, number, number], fov: number): View =>
  ({ pos: new THREE.Vector3(...p), look: new THREE.Vector3(...l), fov });

export type Stage = {
  board: Board;
  /** Fly from wherever the camera is to a side's playing view. */
  toGame(side: Color): Promise<void>;
  /** Back to the slow drift in front of the Templo Mayor. */
  toIntro(): Promise<void>;
  setCursor(pointer: boolean): void;
  /** Where a square's centre lands on screen, in CSS pixels (used by the browser tests). */
  project(sq: Square, height?: number): { x: number; y: number };
};

export type StageEvents = {
  onReady(stage: Stage): void;
  onSquare(hit: Hit): void;
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
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 16, 72);
  scene.add(sky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(lightformers(), 0.02).texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 22;
  controls.maxPolarAngle = 1.32;
  controls.enabled = false;

  // ── Light: a stage pool on the board, warm fire around, a cold rim behind ──
  const key = new THREE.SpotLight('#fff0dc', 420, 0, 0.56, 0.6, 2);
  key.position.set(-3.2, 13, 5.5);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#c4cee2', 1.8);
  rim.position.set(3, 9, -12);
  const fill = new THREE.DirectionalLight('#ffe6cc', 0.55); // from the player's seat, so faces never go to mud
  fill.position.set(2, 6, 12);
  scene.add(rim, fill);
  // The monument's face, lit from the plaza like a floodlit ruin.
  const flood = new THREE.SpotLight('#ffb878', 1100, 0, 0.38, 0.9, 2);
  flood.position.set(0, 0.3, -11);
  flood.target.position.set(0, 5, MONUMENT.z);
  scene.add(flood, flood.target);

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

  // ── Plaza: scanned flagstones running into the dark ───────────────────────
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({
      map: tile('/textures/plaza-diff.jpg', 66, true),
      normalMap: tile('/textures/plaza-nor.jpg', 66),
      roughnessMap: tile('/textures/plaza-rough.jpg', 66),
      color: '#6e655c',
      normalScale: new THREE.Vector2(1.5, 1.5),
    }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  scene.add(plaza);
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

  const fires: Fire[] = [];
  const light = (p: THREE.Vector3, scale: number, seed: number) => {
    const fire = createFire(seed, scale / 1.7);
    fire.group.position.copy(p).setY(0.8 * scale);
    scene.add(fire.group);
    fires.push(fire);
  };

  let board: Board | null = null;
  let disposed = false;

  // ── Camera: a slow drift before the pyramid, then a flight to the board ───
  const narrow = () => camera.aspect < 0.8;
  const INTRO = () => narrow()
    ? V([0, 1.9, 9.5], [0, 5.2, MONUMENT.z], 48)
    : V([0, 1.35, 7.4], [0, 4.6, MONUMENT.z], 32);
  const GAME = (side: Color) => {
    const s = side === 'w' ? 1 : -1;
    return narrow() ? V([0, 17.2, 12.6 * s], [0, 0, 1.5 * s], 52) : V([0, 8.4, 11.2 * s], [0, 0, 1.25 * s], 30);
  };
  let mode: 'intro' | 'flying' | 'game' = 'intro';
  let side: Color = 'w';
  const look = new THREE.Vector3();
  const setView = (v: View) => {
    camera.position.copy(v.pos);
    look.copy(v.look);
    camera.lookAt(look);
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
  };

  async function fly(to: View, dur: number) {
    mode = 'flying';
    controls.enabled = false;
    const p0 = camera.position.clone();
    const l0 = look.clone();
    const f0 = camera.fov;
    const mid = p0.clone().lerp(to.pos, 0.5).add(new THREE.Vector3(0, 2.6, 0)); // rise over the board
    const q = new THREE.Vector3();
    await tween(dur, k => {
      const e = easeInOut(k);
      q.copy(p0).multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(to.pos, e * e);
      camera.position.copy(q);
      look.lerpVectors(l0, to.look, e);
      camera.lookAt(look);
      camera.fov = f0 + (to.fov - f0) * e;
      camera.updateProjectionMatrix();
    });
  }

  const stage: Stage = {
    get board() { return board!; },
    async toGame(s) {
      side = s;
      if (mode === 'game') look.copy(controls.target); // flying from wherever the player left it
      await fly(GAME(s), 2.8);
      controls.target.copy(GAME(s).look);
      controls.enabled = true;
      mode = 'game';
    },
    async toIntro() {
      if (mode === 'game') look.copy(controls.target);
      await fly(INTRO(), 2.4);
      mode = 'intro';
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
    const [pieces, slabs, frame, corner, brazier, monument] = await Promise.all([
      Promise.all((['w', 'b'] as Color[]).map(c => Promise.all(kinds.map(k => load(MODEL[k], STONE[c], 9))))),
      Promise.all((['cantera', 'andesite'] as const).map(s => Promise.all([0, 1, 2].map(v => load(`slab${v}`, s, 4))))),
      load('frame', 'basalt', 7),
      load('corner', 'basalt', 5),
      load('brazier', 'basalt', 7),
      load('monument', 'tezontle', 9),
    ]);
    if (disposed) return;

    // Slabs: light squares in cantera, dark in andesite; variants and turns dealt by a fixed hash.
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const h = (f * 73 + r * 151 + f * r * 31) % 97;
        place(slabs[(f + r) % 2 === 1 ? 0 : 1][h % 3], at(f, r), (h % 4) * Math.PI / 2)
          .traverse(o => { o.castShadow = false; }); // flat: nothing to cast
      }
    }
    for (let k = 0; k < 4; k++) {
      const edge = new THREE.Group();
      edge.rotation.y = k * Math.PI / 2;
      for (const x of [-3, -1, 1, 3]) place(frame, new THREE.Vector3(x, 0, 4.25), 0, 1, edge);
      place(corner, new THREE.Vector3(4.3, 0, 4.25), 0, 1, edge);
      scene.add(edge);
    }
    [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
      const p = new THREE.Vector3(sx * BRAZIER.inset, 0, sz * BRAZIER.inset);
      place(brazier, p, i * 0.7, BRAZIER.scale);
      light(p, BRAZIER.scale, i * 1.37 + 0.4);
    });

    // The Templo Mayor itself, across the plaza, its stairs facing the board.
    place(monument, new THREE.Vector3(0, 0, MONUMENT.z), 0, MONUMENT.scale).traverse(o => { o.castShadow = false; });
    for (const sx of [-1, 1]) {
      const p = new THREE.Vector3(sx * 7.6, 0, MONUMENT.z + 7.8);
      place(brazier, p, sx, 3.2);
      light(p, 3.2, sx * 2.1 + 5);
    }

    const models = { w: {}, b: {} } as Models;
    (['w', 'b'] as Color[]).forEach((c, i) => kinds.forEach((k, j) => { models[c][k] = pieces[i][j]; }));
    board = createBoard(scene, models);
    // Compile every shader now, behind the curtain, not on the first click.
    const warm = board.warmup();
    scene.add(...warm);
    renderer.compile(scene, camera);
    scene.remove(...warm);
    renderer.shadowMap.needsUpdate = true;
    events.onReady(stage);
  })();

  // ── Post: bloom only catches what burns ───────────────────────────────────
  // The composer's own target has no MSAA; give it one on low-density screens.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: dpr < 1.5 ? 4 : 0 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.3, 1.0));
  composer.addPass(new OutputPass());

  // ── Pointer: a click is a press that didn't become a drag ─────────────────
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  let hovered = '';
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    if (!down || mode !== 'game' || !board) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    toNdc(e);
    events.onSquare(board.pick(ndc, camera));
  };
  // Hover picks once per frame at most, however fast the trackpad reports.
  let hoverDirty = false;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    toNdc(e);
    hoverDirty = true;
  };
  const onLeave = () => { hovered = ''; events.onHover({ piece: null, ground: null }); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    if (mode === 'intro') setView(INTRO());
    if (mode === 'game') {
      const v = GAME(side);
      camera.fov = v.fov;
      controls.target.copy(v.look);
    }
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  // Dev: ?cam=x,y,z&look=x,y,z pins the camera for screenshots.
  const q = new URLSearchParams(location.search);
  const pin = q.get('cam')?.split(',').map(Number);
  if (pin?.length === 3) {
    mode = 'game';
    camera.position.set(pin[0], pin[1], pin[2]);
    controls.target.fromArray(q.get('look')?.split(',').map(Number) ?? [0, 0.3, 0]);
    controls.enabled = true;
  }

  // Adaptive resolution: a machine that can't hold ~45 fps renders fewer pixels.
  let slow = 1 / 60;
  let sampled = -3; // let the first seconds after loading (shader compiles, texture uploads) pass
  const adapt = (raw: number) => {
    slow = slow * 0.95 + raw * 0.05;
    if ((sampled += raw) < 2.5) return;
    sampled = 0;
    if (slow > 1 / 45 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      resize();
    }
  };

  const timer = new THREE.Timer();
  renderer.setAnimationLoop(() => {
    timer.update();
    const raw = timer.getDelta();
    if (board && !document.hidden) adapt(Math.min(raw, 0.1));
    const dt = Math.min(raw, 1 / 20);
    const t = timer.getElapsed();
    advance(dt);
    const moving = board?.update(dt);
    if (moving || animating()) renderer.shadowMap.needsUpdate = true;
    if (hoverDirty && mode === 'game' && board) {
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
    } else if (mode === 'game') controls.update();
    for (const f of fires) f.update(t, camera);
    composer.render();
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    ro.disconnect();
    controls.dispose();
    composer.dispose();
    pmrem.dispose();
    renderer.dispose();
  };
}
