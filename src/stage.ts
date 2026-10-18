import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createFire, type Fire } from './fire';

type Stone = 'tezontle' | 'basalt' | 'cantera' | 'andesite';
type Kind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

/**
 * The bake carries the carving; a tiling grain normal carries the stone up
 * close, so the surface holds at any distance without bigger textures.
 * Scale is per asset (how much surface its UVs cover), strength per stone.
 */
const GRAIN_MAP: Record<Stone, 'tezontle' | 'basalt'> = { tezontle: 'tezontle', cantera: 'tezontle', basalt: 'basalt', andesite: 'basalt' };
const GRAIN_STRENGTH: Record<Stone, number> = { tezontle: 0.9, cantera: 0.6, basalt: 0.35, andesite: 0.5 };

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
 * What the stone reflects: near-black with a few light cards — two braziers,
 * a dim strip of night sky, a rim. Burnished basalt reads black with clean
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

// Board space: files a–h run along +x, rank 1 is nearest the camera (+z).
const SLAB_TOP = 0.06;
const at = (file: number, rank: number) => new THREE.Vector3(file - 3.5, 0, 3.5 - rank);
const BACK_RANK: Kind[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
const BRAZIER = { scale: 2.2, inset: 6.8 }; // fire sits on the coals, 0.8 up the model

export function createStage(canvas: HTMLCanvasElement, onReady: () => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0a08');
  scene.fog = new THREE.Fog('#0b0a08', 13, 34); // the plaza runs off into the night
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(lightformers(), 0.02).texture;
  scene.environmentIntensity = 0.8;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  camera.position.set(-4.6, 3.7, 10.2); // low, from tezontle's side: the basalt army faces you
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.3, 0.4);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 3.5;
  controls.maxDistance = 26;
  controls.maxPolarAngle = 1.38;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.18;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Warm key from the near brazier side (casts the shadows), a dim cool moon to fill.
  const key = new THREE.DirectionalLight('#ffe2c4', 2.1);
  key.position.set(-6, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key);
  const moon = new THREE.DirectionalLight('#cdd5e2', 0.45);
  moon.position.set(6, 10, -7);
  scene.add(moon);

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
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({
      map: tile('/textures/plaza-diff.jpg', 30, true),
      normalMap: tile('/textures/plaza-nor.jpg', 30),
      roughnessMap: tile('/textures/plaza-rough.jpg', 30),
      color: '#8a8178',
      normalScale: new THREE.Vector2(1.4, 1.4),
    }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // Mortar bed showing between the slabs.
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 8.1), new THREE.MeshStandardMaterial({ color: '#100d0a', roughness: 1 }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.004;
  scene.add(bed);

  // ── Models ────────────────────────────────────────────────────────────────
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Returns the glTF root: the mesh node inside keeps the scale/offset meshopt
  // quantisation stored on it; we only ever move the root.
  const load = async (name: string, stone: Stone, grainScale: number) => {
    const g = await gltf.loadAsync(`/models/${name}-${stone}.glb`);
    g.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      addGrain(m.material as THREE.MeshStandardMaterial, grain[GRAIN_MAP[stone]], grainScale, GRAIN_STRENGTH[stone]);
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
  let disposed = false;

  (async () => {
    const kinds: Kind[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    const sides = ['tezontle', 'basalt'] as const;
    const [pieces, slabs, frame, corner, brazier] = await Promise.all([
      Promise.all(sides.map(s => Promise.all(kinds.map(k => load(k, s, 9))))),
      Promise.all((['cantera', 'andesite'] as const).map(s => Promise.all([0, 1, 2].map(v => load(`slab${v}`, s, 4))))),
      load('frame', 'basalt', 7),
      load('corner', 'basalt', 5),
      load('brazier', 'basalt', 7),
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

    // Border: four kerb segments a side, a carved block at each corner.
    for (let k = 0; k < 4; k++) {
      const side = new THREE.Group();
      side.rotation.y = k * Math.PI / 2;
      for (const x of [-3, -1, 1, 3]) place(frame, new THREE.Vector3(x, 0, 4.25), 0, 1, side);
      place(corner, new THREE.Vector3(4.3, 0, 4.25), 0, 1, side);
      scene.add(side);
    }

    // The armies, facing each other: tezontle on ranks 1–2, basalt on 7–8.
    sides.forEach((_, s) => {
      const [back, pawns] = s === 0 ? [0, 1] : [7, 6];
      const turn = s === 0 ? Math.PI : 0;
      const of = (k: Kind) => pieces[s][kinds.indexOf(k)];
      BACK_RANK.forEach((k, f) => place(of(k), at(f, back).setY(SLAB_TOP), turn));
      for (let f = 0; f < 8; f++) place(of('pawn'), at(f, pawns).setY(SLAB_TOP), turn);
    });

    // Braziers at the four corners, lit.
    [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
      const p = new THREE.Vector3(sx * BRAZIER.inset, 0, sz * BRAZIER.inset);
      place(brazier, p, i * 0.7, BRAZIER.scale);
      const fire = createFire(i * 1.37 + 0.4, BRAZIER.scale / 1.7);
      fire.group.position.copy(p).setY(0.8 * BRAZIER.scale);
      scene.add(fire.group);
      fires.push(fire);
    });

    renderer.compile(scene, camera);
    onReady();
  })();

  // ── Post: bloom only catches what burns ───────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.28, 1.0));
  composer.addPass(new OutputPass());

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Narrow screens: widen the lens and step back so the whole board stays in frame.
    // Portrait: high and square behind tezontle, so the whole board fits between the braziers.
    const narrow = camera.aspect < 0.8;
    camera.fov = narrow ? 50 : 30;
    if (narrow) camera.position.set(0, 17, 11).setLength(21.5);
    else camera.position.sub(controls.target).setLength(11.8).add(controls.target);
    // Dev: ?cam=x,y,z pins the camera for screenshots.
    const pin = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
    if (pin?.length === 3) { camera.position.set(pin[0], pin[1], pin[2]); controls.autoRotate = false; }
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    controls.update();
    for (const f of fires) f.update(t, camera);
    composer.render();
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    composer.dispose();
    pmrem.dispose();
    renderer.dispose();
  };
}
