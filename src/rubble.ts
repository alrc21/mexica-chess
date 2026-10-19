import * as THREE from 'three';
import type { PieceSymbol } from 'chess.js';
import type { Sound } from './audio';

/**
 * A captured piece breaks into pieces of itself: chunks cut from its own baked
 * mesh in Blender (blender/fracture.py), thrown by the blow, tumbling, knocking
 * against the standing pieces and settling. Then the big chunks crumble into
 * dust and grit, and the grit stays where it fell for the rest of the game —
 * the battle leaves its marks. Sparks and a slow cloud of dust go with it.
 */
export type Sfx = (name: Sound, at: THREE.Vector3, gain?: number, rate?: number) => void;
export type Obstacle = { x: number; z: number; r: number; h: number };
type Stone = 'tezontle' | 'basalt';

const GRAVITY = 6; // board units/s²: heavy, slower than a toy falls
const SLAB_TOP = 0.06;
const floorAt = (x: number, z: number) => {
  const m = Math.max(Math.abs(x), Math.abs(z));
  return m < 4 ? SLAB_TOP : m < 4.5 ? 0.11 : 0; // slabs, the basalt frame, the plaza
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Body = {
  o: THREE.Object3D;
  crumble?: number; // seconds into crumbling to dust (big chunks only)
  v: THREE.Vector3;
  w: THREE.Vector3;
  corners: THREE.Vector3[]; // local box corners: the lowest one meets the floor
  r: number;
  asleep: boolean;
  loud: boolean;
};

/** A soft, torn puff: radial falloff broken up by value noise. */
function puffTexture() {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  const img = x.createImageData(n, n);
  const h = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (u: number, v: number) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = h(i, j), b = h(i + 1, j), cc = h(i, j + 1), d = h(i + 1, j + 1);
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / n - 0.5, v = j / n - 0.5;
    const r = Math.hypot(u, v) * 2;
    const f = noise(i / 14, j / 14) * 0.6 + noise(i / 6, j / 6) * 0.4;
    const a = Math.max(0, 1 - r) ** 1.6 * (0.45 + 0.75 * f);
    const k = (j * n + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = Math.min(255, a * 255);
  }
  x.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/** A fixed pool of camera-facing particles; the CPU moves them, the shader draws them. */
function pool(capacity: number, additive: boolean, map: THREE.Texture | null) {
  const pos = new Float32Array(capacity * 3);
  const size = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(additive ? '#ffffff' : '#6d5d4c') }, uMap: { value: map }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize, aAlpha, aSpin;
      uniform float uScale;
      varying float vAlpha, vSpin;
      void main() {
        vAlpha = aAlpha;
        vSpin = aSpin;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: additive ? /* glsl */ `
      varying float vAlpha, vSpin;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(4.0, 1.5, 0.35) * a, a);
      }` : /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      varying float vAlpha, vSpin;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        p = mat2(c, -s, s, c) * p + 0.5;
        float a = texture2D(uMap, p).a * vAlpha;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  type P = { v: THREE.Vector3; age: number; life: number; s0: number; s1: number; a: number; drag: number; g: number; spin: number };
  const live: (P | null)[] = new Array(capacity).fill(null);
  let next = 0;
  return {
    points,
    material,
    emit(at: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, a: number, drag: number, g: number) {
      const i = next;
      next = (next + 1) % capacity;
      pos.set([at.x, at.y, at.z], i * 3);
      spin[i] = rand(0, 6.28);
      live[i] = { v: v.clone(), age: 0, life, s0, s1, a, drag, g, spin: rand(-0.6, 0.6) };
    },
    update(dt: number) {
      let any = false;
      for (let i = 0; i < capacity; i++) {
        const p = live[i];
        if (!p) { alpha[i] = 0; continue; }
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { live[i] = null; alpha[i] = 0; continue; }
        any = true;
        p.v.multiplyScalar(Math.exp(-p.drag * dt));
        p.v.y -= p.g * dt;
        pos[i * 3] += p.v.x * dt;
        pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1] + p.v.y * dt);
        pos[i * 3 + 2] += p.v.z * dt;
        spin[i] += p.spin * dt;
        size[i] = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) ** 2);
        alpha[i] = p.a * Math.min(1, k * 8) * (1 - k) ** 1.5;
      }
      geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = geo.attributes.aSpin.needsUpdate = true;
      return any;
    },
  };
}

export function createRubble(scene: THREE.Scene, sfx: Sfx) {
  const dust = pool(420, false, puffTexture());
  const sparks = pool(160, true, null);
  scene.add(dust.points, sparks.points);
  let shards: Partial<Record<PieceSymbol, THREE.Object3D>> = {};
  let interior: Partial<Record<Stone, THREE.Material>> = {};
  type Pile = { bodies: Body[]; grit: THREE.InstancedMesh; gritBodies: Body[]; age: number; root: THREE.Group; ply: number; settled: boolean };
  const piles: Pile[] = [];
  const CRUMBLE_AFTER = 2.4; // seconds a settled chunk lies there before it goes to dust
  const CRUMBLE_FOR = 0.9;
  const CRUMBS = 6; // grit left behind by each chunk
  const GRIT = new THREE.DodecahedronGeometry(1, 0);

  const tmp = new THREE.Vector3();
  const dq = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();

  function body(o: THREE.Object3D, box: THREE.Box3): Body {
    const c = box.getCenter(new THREE.Vector3());
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
      corners.push(new THREE.Vector3(x, y, z).sub(c));
    return { o, v: new THREE.Vector3(), w: new THREE.Vector3(), corners, r: box.getSize(tmp).length() / 2, asleep: false, loud: true };
  }

  /** Dust rolling out from a base: a landing, a capture, a collapse. */
  function puff(at: THREE.Vector3, n: number, strength = 1, rise = 0.25) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.4, 1.3) * strength;
      tmp.set(at.x + Math.cos(a) * 0.25, SLAB_TOP + rand(0.03, 0.15), at.z + Math.sin(a) * 0.25);
      dust.emit(tmp, new THREE.Vector3(Math.cos(a) * sp, rand(0.05, rise), Math.sin(a) * sp), rand(1.6, 3.2), rand(0.16, 0.3), rand(0.6, 1.2) * (0.6 + 0.4 * strength), rand(0.25, 0.5), 2.2, -0.04);
    }
  }

  /**
   * Break `victim` (a placed piece) apart. `blow` is the attacker's direction of
   * travel (zero for a collapse in place), `power` how hard it was hit.
   */
  function burst(victim: THREE.Object3D, type: PieceSymbol, stone: Stone, blow: THREE.Vector3, power: number, ply = 0) {
    const box = new THREE.Box3().setFromObject(victim);
    const c0 = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    let exterior: THREE.Material | undefined;
    victim.traverse(o => { if ((o as THREE.Mesh).isMesh) exterior = (o as THREE.Mesh).material as THREE.Material; });
    victim.parent?.remove(victim);

    const root = new THREE.Group();
    scene.add(root);
    const bodies: Body[] = [];
    const src = shards[type];
    if (src && exterior) {
      const copy = src.clone();
      copy.position.copy(victim.position);
      copy.quaternion.copy(victim.quaternion);
      copy.scale.copy(victim.scale);
      copy.updateMatrixWorld(true);
      for (const node of [...copy.children]) {
        node.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = (m.material as THREE.Material).name === 'interior' ? interior[stone]! : exterior!;
          m.castShadow = m.receiveShadow = true;
        });
        const b = new THREE.Box3().setFromObject(node);
        const pivot = new THREE.Object3D();
        b.getCenter(pivot.position);
        root.add(pivot);
        pivot.attach(node); // rotations turn about the chunk's own centre
        bodies.push(body(pivot, b));
      }
    }
    // Throw: along the blow, out from the centre, upward — the higher, the harder.
    for (const b of bodies) {
      const p = b.o.position;
      const up = (p.y - box.min.y) / height;
      const out = tmp.copy(p).sub(c0).setY(0).normalize();
      b.v.copy(blow).multiplyScalar(power * (0.6 + 0.9 * up) * rand(0.7, 1.2))
        .addScaledVector(out, rand(0.25, 0.9) * (0.4 + power * 0.5))
        .add(new THREE.Vector3(0, rand(0.5, 1.4) * power * (0.3 + up), 0));
      b.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7) / Math.max(0.5, b.r * 5));
    }

    // Grit: small stones of the same material, one draw call — room for the crumbs to come.
    const n = 44;
    const grit = new THREE.InstancedMesh(GRIT, exterior ?? new THREE.MeshStandardMaterial(), n + bodies.length * CRUMBS);
    grit.count = n;
    grit.castShadow = true;
    grit.frustumCulled = false;
    root.add(grit);
    const gritBodies: Body[] = [];
    for (let i = 0; i < n; i++) {
      const o = new THREE.Object3D();
      const s = rand(0.012, 0.045);
      o.scale.set(s * rand(0.7, 1.3), s * rand(0.6, 1.1), s * rand(0.7, 1.3));
      o.position.set(rand(box.min.x, box.max.x) * 0.7 + c0.x * 0.3, rand(box.min.y, box.max.y), rand(box.min.z, box.max.z) * 0.7 + c0.z * 0.3);
      o.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      const b = body(o, new THREE.Box3().setFromCenterAndSize(o.position, tmp.copy(o.scale).multiplyScalar(1.6)));
      const out = new THREE.Vector3().copy(o.position).sub(c0).setY(0).normalize();
      b.v.copy(blow).multiplyScalar(power * rand(0.3, 1.4)).addScaledVector(out, rand(0.5, 2.2)).add(new THREE.Vector3(0, rand(0.8, 2.6) * Math.max(0.4, power * 0.8), 0));
      b.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      b.loud = false;
      gritBodies.push(b);
    }

    // Sparks off the struck face, a ring of dust from the base, a column from the body.
    const strike = tmp.copy(c0).addScaledVector(blow, -0.25);
    for (let i = 0; i < 26 * Math.min(1, power); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4)).addScaledVector(blow, 1.5);
      sparks.emit(strike, v, rand(0.25, 0.65), rand(0.025, 0.045), 0.012, 1, 0.8, 9);
    }
    puff(new THREE.Vector3(c0.x, 0, c0.z), 22, 1.2 * Math.max(0.6, power * 0.7), 0.35);
    for (let i = 0; i < 12; i++) {
      tmp.set(rand(box.min.x, box.max.x), rand(box.min.y, box.max.y), rand(box.min.z, box.max.z));
      dust.emit(tmp, new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.35), rand(-0.3, 0.3)).addScaledVector(blow, 0.5 * power), rand(2.2, 3.6), rand(0.28, 0.45), rand(1.0, 1.7), 0.35, 1.6, -0.03);
    }
    piles.push({ bodies, grit, gritBodies, age: 0, root, ply, settled: false });
  }

  /** A settled chunk goes to dust: it shrinks inside a puff and leaves crumbs. */
  function crumble(pile: Pile, b: Body, dt: number) {
    if (b.crumble === undefined) {
      b.crumble = 0;
      const p = b.o.position;
      for (let i = 0; i < 6; i++) {
        tmp.set(p.x + rand(-1, 1) * b.r * 0.5, p.y + rand(-0.3, 0.6) * b.r, p.z + rand(-1, 1) * b.r * 0.5);
        dust.emit(tmp, new THREE.Vector3(rand(-0.15, 0.15), rand(0.02, 0.15), rand(-0.15, 0.15)), rand(1.4, 2.4), b.r * 0.9, b.r * 2.6, 0.32, 1.8, -0.02);
      }
      for (let i = 0; i < CRUMBS && pile.grit.count < pile.grit.instanceMatrix.count; i++) {
        const o = new THREE.Object3D();
        const sz = rand(0.01, 0.03) * (0.6 + b.r * 3);
        o.scale.set(sz * rand(0.7, 1.3), sz * rand(0.5, 1), sz * rand(0.7, 1.3));
        o.position.set(p.x + rand(-1, 1) * b.r * 0.6, p.y, p.z + rand(-1, 1) * b.r * 0.6);
        o.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
        const crumb = body(o, new THREE.Box3().setFromCenterAndSize(o.position, tmp.copy(o.scale).multiplyScalar(1.6)));
        crumb.v.set(rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3));
        crumb.loud = false;
        pile.gritBodies.push(crumb);
        pile.grit.count++;
      }
    }
    b.crumble += dt;
    const k = Math.min(1, b.crumble / CRUMBLE_FOR);
    b.o.scale.setScalar(Math.max(0.001, 1 - k * k));
    b.o.position.y -= dt * 0.03;
    if (k >= 1) b.o.visible = false;
  }

  function step(b: Body, dt: number, obstacles: Obstacle[]) {
    const p = b.o.position;
    if (b.asleep) return;
    b.v.y -= GRAVITY * dt;
    p.addScaledVector(b.v, dt);
    const spin = b.w.length();
    if (spin > 1e-4) b.o.quaternion.premultiply(dq.setFromAxisAngle(tmp.copy(b.w).divideScalar(spin), spin * dt));
    // Knock against the standing pieces (upright cylinders).
    for (const s of obstacles) {
      const dx = p.x - s.x, dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      const min = s.r + b.r * 0.5;
      if (d < min && d > 1e-4 && p.y < s.h) {
        const nx = dx / d, nz = dz / d;
        p.x = s.x + nx * min;
        p.z = s.z + nz * min;
        const vn = b.v.x * nx + b.v.z * nz;
        if (vn < 0) {
          b.v.x -= 1.4 * vn * nx;
          b.v.z -= 1.4 * vn * nz;
          b.w.multiplyScalar(0.8);
          if (b.loud && vn < -0.8) sfx('pebble', p, Math.min(1, -vn * 0.3));
        }
      }
    }
    // The lowest corner meets the floor.
    let low = Infinity;
    for (const c of b.corners) low = Math.min(low, tmp.copy(c).applyQuaternion(b.o.quaternion).y);
    const floor = floorAt(p.x, p.z);
    if (p.y + low < floor) {
      p.y = floor - low;
      const vy = b.v.y;
      if (vy < 0) {
        if (b.loud && vy < -0.9) sfx(b.r > 0.12 ? 'thud' : 'pebble', p, Math.min(1, -vy * 0.22) * (b.r > 0.12 ? 0.7 : 1), b.r > 0.12 ? rand(1.1, 1.4) : undefined);
        b.v.y = -vy * 0.28;
        b.v.x *= 0.55;
        b.v.z *= 0.55;
        b.w.multiplyScalar(0.5);
      }
      if (b.v.lengthSq() < 0.02 && Math.abs(b.v.y) < 0.15) { b.asleep = true; b.v.set(0, 0, 0); b.w.set(0, 0, 0); }
    }
  }

  return {
    burst,
    puff,
    setShards(s: Partial<Record<PieceSymbol, THREE.Object3D>>, materials: Record<Stone, THREE.Material>) {
      shards = s;
      interior = materials;
    },
    setDustColor(c: THREE.ColorRepresentation) { (dust.material.uniforms.uColor.value as THREE.Color).set(c); },
    /** Particle sizes are world units: this is drawing-buffer height / (2·tan(fov/2)). */
    setScale(k: number) { dust.material.uniforms.uScale.value = sparks.material.uniforms.uScale.value = k; },
    // The pools live in the scene from the start, so the warm-up compile already sees them.
    warmup(): THREE.Object3D[] { return []; },
    /** Takes back the marks of moves that were undone (everything after `ply`). */
    heal(ply: number) {
      for (let i = piles.length - 1; i >= 0; i--) {
        if (piles[i].ply <= ply) continue;
        scene.remove(piles[i].root);
        piles[i].grit.dispose();
        piles.splice(i, 1);
      }
    },
    /** Advances everything; true while anything is still moving. */
    update(dt: number, obstacles: Obstacle[]) {
      let busy = dust.update(dt);
      busy = sparks.update(dt) || busy;
      for (const pile of piles) {
        if (pile.settled) continue;
        pile.age += dt;
        let moving = false;
        for (const b of pile.bodies) {
          if (!b.o.visible) continue;
          step(b, dt, obstacles);
          if (b.asleep && pile.age > CRUMBLE_AFTER) {
            if (b.crumble === undefined && !pile.bodies.some(o => o.crumble !== undefined && o.o.visible)) sfx('crumble', b.o.position, 0.3, 1.25);
            crumble(pile, b, dt);
          }
          moving = true;
        }
        pile.gritBodies.forEach((b, k) => {
          if (!b.asleep) moving = true;
          step(b, dt, []);
          b.o.updateMatrix();
          pile.grit.setMatrixAt(k, m4.copy(b.o.matrix));
        });
        pile.grit.instanceMatrix.needsUpdate = true;
        // Once the dust has settled the grit is scenery: no more updates.
        if (!moving && pile.age > CRUMBLE_AFTER) pile.settled = true;
        busy = true;
      }
      return busy;
    },
  };
}

export type Rubble = ReturnType<typeof createRubble>;
