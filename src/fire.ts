import * as THREE from 'three';

/**
 * Brazier fire: two noise-driven flame cards that always face the camera,
 * embers rising and drifting, and a warm point light that breathes with them.
 * Flame colours go above 1.0 on purpose: bloom picks them up, stone doesn't.
 */

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}`;

const flameMaterial = (seed: number, intensity: number) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uIntensity: { value: intensity } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uSeed, uIntensity;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      float t = uTime + uSeed;
      float n = fbm(vec2(vUv.x * 3.0 + uSeed, vUv.y * 2.2 - t * 1.9));
      float n2 = fbm(vec2(vUv.x * 6.0 + 3.1 * uSeed, vUv.y * 4.5 - t * 2.8));
      float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 1.1 * vUv.y;   // licks wider toward the tip
      float w = 0.8 * pow(1.0 - vUv.y, 0.7);
      float body = 1.0 - smoothstep(w * 0.35, w, abs(x));
      float fade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.35, 0.95, vUv.y + (n2 - 0.5) * 0.6));
      float f = body * fade * (0.55 + 0.8 * n2);
      vec3 c = mix(vec3(0.8, 0.12, 0.02), vec3(1.0, 0.42, 0.07), smoothstep(0.15, 0.6, f));
      c = mix(c, vec3(1.0, 0.74, 0.38), smoothstep(0.6, 1.0, f));
      gl_FragColor = vec4(c * f * uIntensity, f);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

const emberMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime, uScale;
    varying float vLife;
    void main() {
      float life = fract(uTime * 0.22 + aSeed * 7.13);
      vec3 p = position;
      p.y += life * 2.4;
      p.x += sin(aSeed * 31.0 + uTime * 1.3 + life * 6.0) * 0.3 * life;
      p.z += cos(aSeed * 17.0 + uTime * 1.1 + life * 5.0) * 0.3 * life;
      vLife = life;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uScale * (0.4 + fract(aSeed * 91.0)) * (1.0 - life) * 26.0 / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vLife;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);
      gl_FragColor = vec4(vec3(1.0, 0.42, 0.08) * 4.0 * a, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

/** `glow` scales the light it throws, `flame` the flames themselves (both lower by day). */
export type Fire = { group: THREE.Group; light: THREE.PointLight; update: (t: number, camera: THREE.Camera, glow?: number, flame?: number) => void };

export function createFire(seed: number, size = 1): Fire {
  const group = new THREE.Group();
  // A bed of flames across the bowl: one tall tongue, two lower ones either side.
  const billboard = new THREE.Group();
  const card = (w: number, h: number, x: number, z: number, s: number, intensity: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * size, h * size).translate(0, h * size * 0.48, 0), flameMaterial(s, intensity));
    m.userData.intensity = intensity;
    m.position.set(x * size, 0, z);
    billboard.add(m);
  };
  card(1.0, 1.7, 0.0, 0.0, seed, 1.45);
  card(0.62, 1.05, -0.26, 0.02, seed + 3.1, 1.7);
  card(0.62, 1.15, 0.27, -0.02, seed + 7.3, 1.7);
  card(0.5, 0.7, 0.05, 0.04, seed + 11.7, 2.0);
  group.add(billboard);

  const count = 48;
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.7 * size;
    pos[i * 3 + 1] = 0.3 * size;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.7 * size;
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const embers = new THREE.Points(geo, emberMaterial());
  embers.frustumCulled = false;
  group.add(embers);

  const light = new THREE.PointLight('#ff8636', 0, 0, 2);
  light.position.y = 0.7 * size;
  group.add(light);

  const world = new THREE.Vector3();
  return {
    group,
    light,
    update(t, camera, glow = 1, flame = 1) {
      group.getWorldPosition(world);
      billboard.rotation.y = Math.atan2(camera.position.x - world.x, camera.position.z - world.z);
      for (const c of billboard.children) {
        const u = ((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = t;
        u.uIntensity.value = c.userData.intensity * flame;
      }
      embers.material.uniforms.uTime.value = t + seed * 3;
      // Breathing, not strobing: two slow sines and a faster flutter.
      light.intensity = 40 * glow * (0.82 + 0.1 * Math.sin(t * 2.3 + seed) + 0.06 * Math.sin(t * 7.1 + seed * 2) + 0.04 * Math.sin(t * 13.7));
    },
  };
}
