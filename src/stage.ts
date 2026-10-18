import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type Stone = 'tezontle' | 'basalt';
export const STONES: Stone[] = ['tezontle', 'basalt'];

/**
 * The bake carries the carving; this tiling grain carries the stone up close,
 * so the surface holds at any distance without a bigger texture.
 */
const GRAIN: Record<Stone, { scale: number; strength: number }> = {
  tezontle: { scale: 9, strength: 0.9 },
  basalt: { scale: 8, strength: 0.35 },
};

function addGrain(mat: THREE.MeshStandardMaterial, map: THREE.Texture, { scale, strength }: { scale: number; strength: number }) {
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
  card('#ff9447', 7, 1.2, 1.6, -4, 1.2, 2.6); // brazier, key side
  card('#ff8236', 3, 1.0, 1.2, 4.6, 0.8, -2.2); // brazier, far side
  card('#efe6da', 0.9, 7, 1.2, 0, 6, 0); // night sky overhead
  card('#f3ece4', 2.2, 3.2, 0.5, 2.2, 2.4, -5); // rim
  return env;
}

export function createStage(canvas: HTMLCanvasElement, onReady: () => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0a08');
  scene.environmentIntensity = 1;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
  camera.position.set(0, 1.3, 3.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.3, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.1;
  controls.maxDistance = 7;
  controls.maxPolarAngle = 1.48;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Near-neutral key so basalt stays black; the warmth comes from the braziers it reflects.
  const key = new THREE.DirectionalLight('#fff1e2', 3.6);
  key.position.set(-2.3, 2.4, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 8 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#f3ece4', 1.6);
  rim.position.set(2.6, 1.7, -2.4);
  scene.add(rim);

  // The floor dissolves into the page colour: no horizon, the stone floats in the dark.
  const fade = document.createElement('canvas');
  fade.width = fade.height = 256;
  const ctx = fade.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.18, '#fff');
  grad.addColorStop(0.62, '#000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4, 96),
    new THREE.MeshStandardMaterial({ color: '#050403', roughness: 0.96, transparent: true, alphaMap: new THREE.CanvasTexture(fade) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const textures = new THREE.TextureLoader();
  const grainMap = (s: Stone) => {
    const t = textures.load(`/textures/grain-${s}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(lightformers(), 0.02).texture;
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let disposed = false;

  (async () => {
    const pieces = await Promise.all(STONES.map(s => gltf.loadAsync(`/models/rook-${s}.glb`)));
    if (disposed) return;
    pieces.forEach((g, i) => {
      const stone = STONES[i];
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        addGrain(m.material as THREE.MeshStandardMaterial, grainMap(stone), GRAIN[stone]);
      });
      // Side by side, stairways turned a little toward each other.
      g.scene.position.x = i ? 0.52 : -0.52;
      g.scene.rotation.y = i ? -0.42 : 0.42;
      scene.add(g.scene);
    });
    renderer.compile(scene, camera);
    onReady();
  })();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow screens: widen the lens so both pieces stay in frame.
    const narrow = camera.aspect < 0.8;
    camera.fov = narrow ? 40 : 26;
    camera.position.setLength(+(new URLSearchParams(location.search).get('d') ?? 0) || (narrow ? 6.6 : 3.82));
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    pmrem.dispose();
    renderer.dispose();
  };
}
