import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Calakmul: the board on the summit of a Maya pyramid, the rainforest canopy
 * far below running to the horizon, mist lying in it, and other temples
 * breaking through the trees. The canopy is one plane: every tree crown is
 * drawn per pixel (Voronoi domes), so it holds from the board's edge to the haze.
 */

export const CANOPY_Y = -11;
const SUMMIT = 10.5; // half-width of the summit platform (the walker stops at 9.5)

const GLSL_NOISE = /* glsl */ `
float jh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 jh2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float jn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(jh(i), jh(i + vec2(1, 0)), f.x), mix(jh(i + vec2(0, 1)), jh(i + vec2(1, 1)), f.x), f.y);
}
float jfbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * jn(p); p *= 2.07; a *= 0.5; } return v; }
// Nearest and second-nearest feature points: crown centre, crown id, gap to the next crown.
vec4 crowns(vec2 p, out vec2 toCentre) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.0), id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = 0.15 + 0.7 * jh2(i + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; best = r; id = i + g; } else if (d < d2) d2 = d;
  }
  toCentre = best;
  return vec4(sqrt(d1), sqrt(d2), jh(id), jh(id + 17.3));
}`;

// Two layers of crowns — big emergent trees over a floor of smaller ones — and hills under both.
const GLSL_CANOPY = /* glsl */ `
float hills(vec2 w) { return (jfbm(w * 0.012) - 0.5) * 7.0 + (jfbm(w * 0.05) - 0.5) * 2.0; }
// Height of the canopy at w; also the winning crown's offset, id and dome for shading.
float canopyAt(vec2 w, out vec2 toC, out vec4 cell, out float dome) {
  vec2 tb, ts;
  vec4 big = crowns(w / 4.6, tb);
  vec4 small = crowns(w / 2.1 + 7.13, ts);
  float db = clamp(1.0 - big.x * big.x * 1.45, 0.0, 1.0);
  float ds = clamp(1.0 - small.x * small.x * 1.45, 0.0, 1.0);
  float hb = sqrt(db) * (1.4 + 2.2 * big.z) * step(0.35, big.w);      // not every big cell holds a giant
  float hs = sqrt(ds) * (0.9 + 0.7 * small.z);
  if (hb > hs) { toC = tb; cell = big; dome = db; return hb; }
  toC = ts; cell = small; dome = ds; return hs;
}`;

/** One canopy surface. `relief`: crowns displaced in the vertices too (near), or drawn flat (far). */
function canopySurface(size: number, segments: number, relief: boolean) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_CANOPY}\nvarying vec3 vJungle;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 wxz = (modelMatrix * vec4(position, 1.0)).xz;
        vec2 toC0; vec4 cell0; float dome0;
        // The far sheet sinks out of sight under the near crowns, and rises to meet their flattened edge.
        float ring = max(abs(wxz.x), abs(wxz.y));
        transformed.y += hills(wxz) + ${relief
          ? 'canopyAt(wxz, toC0, cell0, dome0) * (1.0 - smoothstep(176.0, 210.0, ring))' // crowns flatten toward the edge
          : 'mix(-4.0, 1.2, smoothstep(190.0, 210.0, ring))'};`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vJungle = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_CANOPY}\nvarying vec3 vJungle;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 toC; vec4 c; float dome;
        float h = canopyAt(vJungle.xz, toC, c, dome);
        float detail = 1.0 - smoothstep(0.15, 0.9, length(fwidth(vJungle.xz / 2.1)));
        float gap = smoothstep(0.0, 0.3, c.y - c.x);
        float leaves = jfbm(vJungle.xz * 2.6);
        float patches = jfbm(vJungle.xz * 0.02);
        vec3 green = mix(vec3(0.028, 0.062, 0.02), vec3(0.075, 0.135, 0.04), c.z);
        green = mix(green, vec3(0.045, 0.09, 0.055), step(0.8, c.w) * 0.7);   // a bluer species
        green = mix(green, vec3(0.13, 0.15, 0.04), step(0.62, c.w) * step(c.w, 0.66)); // fresh yellow-green
        green = mix(green, vec3(0.26, 0.2, 0.05), step(0.988, c.w));          // a tree in flower
        float shade = mix(0.35, 1.0, dome) * mix(0.25, 1.0, gap) * (0.7 + 0.6 * leaves);
        vec3 far = mix(vec3(0.035, 0.068, 0.028), vec3(0.07, 0.12, 0.042), patches);
        diffuseColor.rgb *= mix(far, green * shade * (0.85 + 0.3 * patches), detail);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 lp = vJungle.xz * 2.6;
          vec2 e = vec2(0.6, 0.0);
          vec2 leafGrad = vec2(jfbm(lp + e.xy) - jfbm(lp - e.xy), jfbm(lp + e.yx) - jfbm(lp - e.yx));
          float slope = 1.6 * sqrt(max(dome, 0.02));
          vec3 nW = normalize(vec3(-toC.x * slope - leafGrad.x * 1.1, 1.0, -toC.y * slope - leafGrad.y * 1.1));
          nW = normalize(mix(vec3(0.0, 1.0, 0.0), nW, detail));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => `canopy-${relief}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = relief ? CANOPY_Y : CANOPY_Y - 0.6;
  return mesh;
}

/** Near the pyramid every crown stands up in relief; beyond, the same forest is painted flat. */
function canopy() {
  const g = new THREE.Group();
  g.add(canopySurface(420, 560, true), canopySurface(1600, 160, false));
  return g;
}

/** Mist lying in the forest: slow noise sheets, thicker in the hollows, gone near the eye. */
function mist(y: number, density: number, seed: number) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#e9e3d6') }, uDensity: { value: density }, uSeed: { value: seed } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDensity, uSeed;
      uniform vec3 uColor;
      varying vec3 vW;
      ${GLSL_NOISE}
      void main() {
        vec2 p = vW.xz * 0.012 + vec2(uTime * 0.004, uTime * 0.0025) + uSeed;
        float m = smoothstep(0.55, 0.95, jfbm(p) + 0.3 * jfbm(p * 3.0 - uTime * 0.01));
        float d = length(vW.xz - cameraPosition.xz);
        float near = smoothstep(6.0, 40.0, d);          // never a wall in front of the lens
        float far = 1.0 - smoothstep(90.0, 260.0, d);   // seen edge-on far away, sheets read as water
        gl_FragColor = vec4(uColor, m * uDensity * near * far);
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), mat);
  mesh.position.y = y;
  mesh.renderOrder = 1;
  return mesh;
}

/** Box-project UVs from world position (scale = texture repeats per unit), so tiling is even across blocks. */
function worldUv(geo: THREE.BufferGeometry, scale: number) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Weathering in vertex colour: darker and greener low down, lichen-dark streaks, paler tops. */
function weather(geo: THREE.BufferGeometry, y0: number, y1: number, seed: number, dark = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const h = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    const streak = 0.85 + 0.15 * Math.sin(p.getX(i) * 1.7 + seed) * Math.sin(p.getZ(i) * 1.3 + seed * 2);
    const up = Math.max(0, n.getY(i));
    const moss = (1 - h) ** 2 * 0.6;
    const base = (0.55 + 0.45 * h) * streak * (0.9 + 0.1 * up) * dark;
    col.set([base * (1 - moss * 0.45), base * (1 - moss * 0.15), base * (1 - moss * 0.6)], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const block = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

/** The summit the board stands on, and the terraces of its pyramid falling to the trees. */
function summit(material: THREE.Material, floor: THREE.Material) {
  const parts: THREE.BufferGeometry[] = [];
  // The floor the board stands on: the same cut flagstones as the plaza, so the board belongs to it.
  const deck = new THREE.Mesh(worldUv(new THREE.BoxGeometry(SUMMIT * 2, 0.6, SUMMIT * 2).translate(0, -0.3, 0), 0.25), floor);
  deck.receiveShadow = true;
  // A low curb round the rim, open where the stairs come up.
  for (const s of [-1, 1]) {
    parts.push(block(SUMMIT * 2, 0.16, 0.5, 0, 0, s * (SUMMIT - 0.25)));
    parts.push(block(0.5, 0.16, 2 * SUMMIT - 1, s * (SUMMIT - 0.25), 0, 0));
  }
  // Terraces: tall, steep, each one set back — the Maya profile.
  let half = SUMMIT, top = -0.6;
  for (let i = 0; i < 6; i++) {
    const h = 2.7;
    half += 1.15;
    parts.push(block(half * 2, h, half * 2, 0, top - h, 0));
    parts.push(block(half * 2 + 0.3, 0.22, half * 2 + 0.3, 0, top - 0.22, 0)); // a moulding at each lip
    top -= h;
  }
  // The great stairway down the front (+z), one step per 0.3.
  const steps = Math.round(-top / 0.3);
  for (let i = 0; i < steps; i++) parts.push(block(4.2, 0.3, 0.42, 0, -0.3 * (i + 1), SUMMIT + 0.21 + i * 0.4));
  const geo = weather(worldUv(mergeGeometries(parts.map(g => g.toNonIndexed())), 0.14), top, 0, 3);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  const g = new THREE.Group();
  g.add(deck, mesh);
  return g;
}

/** A Maya temple breaking through the canopy: steep tiers, a stair, a shrine and a roof comb. */
function temple(material: THREE.Material, base: number, tiers: number, tierH: number, seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  let half = base, y = CANOPY_Y - 6;
  for (let i = 0; i < tiers; i++) {
    parts.push(block(half * 2, tierH, half * 2, 0, y, 0));
    parts.push(block(half * 2 + 0.6, tierH * 0.12, half * 2 + 0.6, 0, y + tierH * 0.88, 0));
    y += tierH;
    half *= 0.83;
  }
  const stairW = half * 0.9;
  const run = (y - (CANOPY_Y - 6)) * 0.62;
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    parts.push(block(stairW, (y - (CANOPY_Y - 6)) / 40, run / 40 + 0.05, 0, CANOPY_Y - 6 + t * (y - (CANOPY_Y - 6)), base - t * (base - half) + run / 80));
  }
  // Shrine with a dark doorway, then the roof comb, pierced.
  parts.push(block(half * 1.5, half * 0.9, half * 1.1, 0, y, 0));
  parts.push(block(half * 1.7, half * 0.12, half * 1.3, 0, y + half * 0.9, 0));
  const comb = y + half * 1.02;
  parts.push(block(half * 1.3, half * 0.35, half * 0.35, 0, comb, -half * 0.1));
  parts.push(block(half * 0.32, half * 0.75, half * 0.35, -half * 0.5, comb + half * 0.35, -half * 0.1));
  parts.push(block(half * 0.32, half * 0.75, half * 0.35, half * 0.5, comb + half * 0.35, -half * 0.1));
  parts.push(block(half * 1.3, half * 0.3, half * 0.35, 0, comb + half * 1.1, -half * 0.1));
  // Lichen-dark and moss-green: limestone that has stood in the rain forest for a thousand years.
  const geo = weather(worldUv(mergeGeometries(parts.map(g => g.toNonIndexed())), 0.08), CANOPY_Y - 6, comb + half * 1.4, seed, 0.62);
  const mesh = new THREE.Mesh(geo, material);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(half * 0.35, half * 0.55), new THREE.MeshBasicMaterial({ color: '#050403' }));
  door.position.set(0, y + half * 0.28, half * 0.551);
  mesh.add(door);
  return mesh;
}

type Maps = { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture };
export function createJungle(textures: Maps & { floor: Maps }) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    map: textures.map, normalMap: textures.normal, roughnessMap: textures.rough,
    vertexColors: true, color: '#d9d8d0', normalScale: new THREE.Vector2(1.2, 1.2),
  });
  const top = new THREE.MeshStandardMaterial({
    map: textures.floor.map, normalMap: textures.floor.normal, roughnessMap: textures.floor.rough, color: '#cfc8b8',
  });
  group.add(summit(stone, top));
  group.add(canopy());
  const mists = [mist(CANOPY_Y + 2, 0.36, 0), mist(CANOPY_Y + 4.5, 0.2, 7.3)];
  group.add(...mists);
  // Temples on the horizon: the great one straight ahead, others scattered, each half-drowned in trees.
  const spots: [number, number, number, number, number, number][] = [
    [-30, -170, 14, 7, 4.6, 0.2], [95, -230, 10, 6, 4.0, 2.1], [-150, -120, 9, 6, 3.6, 4.4],
    [170, -60, 8, 5, 3.4, 1.3], [-210, -260, 12, 6, 4.0, 5.2], [60, -360, 13, 7, 4.2, 3.3],
    [48, -75, 6, 4, 3.0, 0.7], [-70, -45, 5, 4, 2.8, 1.9], // nearer, mostly swallowed by the trees
  ];
  for (const [x, z, base, tiers, h, rot] of spots) {
    const t = temple(stone, base, tiers, h, x * 0.1);
    t.position.set(x, 0, z);
    t.rotation.y = Math.atan2(-x, -z) + rot * 0.1; // stairs (+z) turned roughly toward us
    group.add(t);
  }
  return {
    group,
    stone,
    mists,
    update(t: number, mistColor: THREE.Color) {
      for (const m of mists) {
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = t;
        u.uColor.value.copy(mistColor);
      }
    },
  };
}

export type Jungle = ReturnType<typeof createJungle>;
