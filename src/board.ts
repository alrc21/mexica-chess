import * as THREE from 'three';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import { easeInOut, easeOutBack, tween } from './anim';

export const SLAB_TOP = 0.06;
const LIFT = 0.09;

/** Board space: files a–h along +x, rank 1 nearest +z (tezontle's side). */
export const squarePos = (sq: Square) =>
  new THREE.Vector3(sq.charCodeAt(0) - 97 - 3.5, SLAB_TOP, 3.5 - (+sq[1] - 1));

export type Models = Record<Color, Record<PieceSymbol, THREE.Object3D>>;
export type Marks = {
  selected?: Square | null;
  moves?: Square[];
  captures?: Square[];
  last?: [Square, Square] | null;
  check?: Square | null;
};
export type Board = ReturnType<typeof createBoard>;
/** What's under the pointer: the first stone the ray meets, and the square on the ground. */
export type Hit = { piece: Square | null; ground: Square | null };
type Effect = (dt: number) => boolean; // false when finished

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Marks are whole squares of light, not dots: a soft fill that glows toward
 * the edges, a bright line and a dark keyline outside it, so a tile reads on
 * pale cantera and grey andesite alike. One shader, one material per tile.
 */
const TILE = new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2);
const tileMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color() },
    uFill: { value: 0 }, uGlow: { value: 0 }, uLine: { value: 0 }, uPulse: { value: 0 },
    uReveal: { value: 0 }, uHover: { value: 0 }, uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // Premultiplied: the fill and glow add light to the stone (its grain stays
  // visible), the line is laid on top, the keyline darkens what's under it.
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uFill, uGlow, uLine, uPulse, uReveal, uHover, uTime;
    varying vec2 vUv;
    void main() {
      vec2 q = abs(vUv - 0.5);
      float e = 0.5 - max(q.x, q.y);           // 0 at the edge, 0.5 at the centre
      float aa = fwidth(e);
      float line = smoothstep(0.026 - aa, 0.026, e) * (1.0 - smoothstep(0.048, 0.048 + aa, e)) * uLine;
      float key = smoothstep(0.008 - aa, 0.008, e) * (1.0 - smoothstep(0.026, 0.026 + aa, e)) * step(0.001, uLine) * 0.6;
      float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 4.0);
      float light = (uFill + uHover * 0.14 + (uGlow + uHover * 0.25) * exp(-e * 11.0)) * pulse * (1.0 - line);
      vec3 rgb = uColor * light + mix(uColor, vec3(1.0), 0.55) * line;
      gl_FragColor = vec4(rgb, line + key) * uReveal;
    }`,
  transparent: true,
  depthWrite: false,
  fog: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
});
type TileKind = 'move' | 'capture' | 'selected' | 'last' | 'check';
const TILES: Record<TileKind, { color: string; fill: number; glow: number; line: number; pulse?: number }> = {
  move: { color: '#ffb35c', fill: 0.16, glow: 0.55, line: 0.9 },
  capture: { color: '#ff4a22', fill: 0.22, glow: 0.8, line: 1 },
  selected: { color: '#ffd9a3', fill: 0.22, glow: 0.35, line: 1 },
  last: { color: '#f2b66a', fill: 0.08, glow: 0.14, line: 0 },
  check: { color: '#ff2a1a', fill: 0.3, glow: 0.7, line: 1, pulse: 1 },
};

const SHARD = new THREE.IcosahedronGeometry(1, 0);

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createBoard(scene: THREE.Scene, models: Models) {
  const group = new THREE.Group();
  const marks = new THREE.Group();
  scene.add(group, marks);
  const pieces = new Map<Square, THREE.Object3D>();
  const effects: Effect[] = [];
  const dustTex = dustTexture();
  let lifted: THREE.Object3D | null = null;

  function spawn(color: Color, type: PieceSymbol, sq: Square) {
    const o = models[color][type].clone();
    o.position.copy(squarePos(sq));
    o.rotation.y = color === 'w' ? Math.PI : 0; // the armies face each other
    o.userData = { square: sq };
    group.add(o);
    pieces.set(sq, o);
    return o;
  }

  let dirty = false; // pieces changed without an effect running: shadows must catch up once
  function setBoard(board: ({ square: Square; type: PieceSymbol; color: Color } | null)[][]) {
    dirty = true;
    group.clear();
    pieces.clear();
    lifted = null;
    for (const p of board.flat()) if (p) spawn(p.color, p.type, p.square);
  }

  // Tiles light up in a wave running out from the selected piece along its paths.
  const tiles = new Map<Square, THREE.Mesh>();
  let hovered: THREE.Mesh | null = null;
  let clock = 0;
  let wave = 0; // a new highlight retires the previous wave
  function highlight(m: Marks) {
    for (const t of marks.children) ((t as THREE.Mesh).material as THREE.Material).dispose();
    marks.clear();
    tiles.clear();
    hovered = null;
    const origin = m.selected ? squarePos(m.selected) : null;
    const put = (kind: TileKind, sq: Square, y: number) => {
      const spec = TILES[kind];
      const material = tileMaterial();
      const u = material.uniforms;
      u.uColor.value.set(spec.color);
      u.uFill.value = spec.fill;
      u.uGlow.value = spec.glow;
      u.uLine.value = spec.line;
      u.uPulse.value = spec.pulse ?? 0;
      const mesh = new THREE.Mesh(TILE, material);
      mesh.position.copy(squarePos(sq)).setY(y);
      mesh.renderOrder = 2;
      mesh.userData.delay = origin && (kind === 'move' || kind === 'capture') ? 0.045 * mesh.position.distanceTo(origin) : 0;
      marks.add(mesh);
      if (kind === 'move' || kind === 'capture') tiles.set(sq, mesh);
    };
    if (m.last) for (const sq of m.last) put('last', sq, 0.071);
    if (m.check) put('check', m.check, 0.072);
    if (m.selected) put('selected', m.selected, 0.073);
    for (const sq of m.moves ?? []) put('move', sq, 0.074);
    for (const sq of m.captures ?? []) put('capture', sq, 0.074);
    const born = clock;
    const id = ++wave;
    const reveal = () => {
      if (id !== wave) return false;
      let pending = false;
      for (const t of marks.children) {
        const k = Math.min(1, Math.max(0, (clock - born - t.userData.delay) / 0.22));
        const u = ((t as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
        u.uReveal.value = k * (2 - k);
        t.scale.setScalar(0.86 + 0.14 * k * (2 - k));
        if (k < 1) pending = true;
      }
      return pending;
    };
    reveal();
    effects.push(reveal);
  }

  /** The tile under the pointer brightens, so the target is confirmed before the click. */
  function hoverTile(sq: Square | null) {
    const next = (sq && tiles.get(sq)) || null;
    if (next === hovered) return;
    if (hovered) (hovered.material as THREE.ShaderMaterial).uniforms.uHover.value = 0;
    if (next) (next.material as THREE.ShaderMaterial).uniforms.uHover.value = 1;
    hovered = next;
  }

  /** Raise the selected piece a hand's breadth; drop the previous one. */
  function lift(sq: Square | null) {
    const next = sq ? pieces.get(sq) ?? null : null;
    for (const [o, up] of [[lifted, false], [next, true]] as const) {
      if (!o || (o === lifted && o === next)) continue;
      const y0 = o.position.y;
      const y1 = SLAB_TOP + (up ? LIFT : 0);
      tween(0.22, k => { o.position.y = y0 + (y1 - y0) * easeInOut(k); });
    }
    lifted = next;
  }

  // ── Picking: the stone you can see, then the square under it ─────────────
  // Triangles, not boxes: a box around a tall piece covers the squares behind it.
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB_TOP);
  const hit = new THREE.Vector3();
  const hits: THREE.Intersection[] = [];
  function pick(ndc: THREE.Vector2, camera: THREE.Camera): Hit {
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(group.children, true, hits);
    let piece: Square | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.square) o = o.parent;
      if (o) { piece = o.userData.square; break; }
    }
    let ground: Square | null = null;
    if (ray.ray.intersectPlane(plane, hit)) {
      const f = Math.floor(hit.x + 4);
      const r = Math.floor(4 - hit.z);
      if (f >= 0 && f < 8 && r >= 0 && r < 8) ground = (String.fromCharCode(97 + f) + (r + 1)) as Square;
    }
    return { piece, ground };
  }

  // ── Motion ────────────────────────────────────────────────────────────────
  /** Carry a piece in an arc, leaning into the move; `impact` fires just before it lands. */
  function arc(o: THREE.Object3D, to: THREE.Vector3, leap: boolean, dur: number, impact?: () => void) {
    const from = o.position.clone();
    const flatD = Math.hypot(to.x - from.x, to.z - from.z);
    const h = leap ? 0.95 : 0.22 + 0.07 * flatD;
    const dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    const axis = new THREE.Vector3(0, 1, 0).cross(dir);
    const base = o.quaternion.clone();
    const lean = new THREE.Quaternion();
    let struck = false;
    return tween(dur, k => {
      const e = easeInOut(k);
      o.position.lerpVectors(from, to, e);
      o.position.y += Math.sin(Math.PI * e) * h;
      if (flatD > 0) o.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, 0.2 * Math.sin(Math.PI * e)));
      if (impact && !struck && k > 0.7) { struck = true; impact(); }
    }).then(() => {
      o.quaternion.copy(base);
      o.position.copy(to);
      dust(to, 14, 0.22, 0.6);
    });
  }

  function dust(at: THREE.Vector3, n: number, opacity: number, spread: number) {
    const pos = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      pos.set([at.x + Math.cos(a) * 0.3, SLAB_TOP + rand(0.02, 0.12), at.z + Math.sin(a) * 0.3], i * 3);
      vel.push(new THREE.Vector3(Math.cos(a) * rand(0.3, 1) * spread, rand(0.1, 0.5), Math.sin(a) * rand(0.3, 1) * spread));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: dustTex, color: '#9a8a76', size: 0.32, transparent: true, depthWrite: false, opacity });
    const points = new THREE.Points(geo, m);
    scene.add(points);
    let age = 0;
    effects.push(dt => {
      age += dt;
      for (let i = 0; i < n; i++) {
        vel[i].multiplyScalar(0.95);
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] += vel[i].y * dt;
        pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      m.opacity = opacity * Math.max(0, 1 - age / 1.4);
      m.size = 0.32 + age * 0.5;
      if (age < 1.4) return true;
      scene.remove(points);
      geo.dispose();
      m.dispose();
      return false;
    });
  }

  /** The captured piece bursts into stone: shards of its own material, bouncing, then gone. */
  function shatter(victim: THREE.Object3D) {
    const b = new THREE.Box3().setFromObject(victim);
    const c = b.getCenter(new THREE.Vector3());
    let material: THREE.Material | undefined;
    victim.traverse(o => { if ((o as THREE.Mesh).isMesh) material = (o as THREE.Mesh).material as THREE.Material; });
    group.remove(victim);
    const shards = new THREE.Group();
    scene.add(shards);
    const parts = Array.from({ length: 46 }, () => {
      const m = new THREE.Mesh(SHARD, material);
      const s = new THREE.Vector3(rand(0.025, 0.085), rand(0.02, 0.07), rand(0.025, 0.08));
      m.scale.copy(s);
      m.position.set(rand(b.min.x, b.max.x) * 0.8 + c.x * 0.2, rand(b.min.y, b.max.y), rand(b.min.z, b.max.z) * 0.8 + c.z * 0.2);
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      m.castShadow = true;
      shards.add(m);
      const height = (m.position.y - b.min.y) / (b.max.y - b.min.y + 1e-3);
      const v = m.position.clone().sub(c).setY(0).normalize().multiplyScalar(rand(0.6, 2.4));
      v.y = rand(0.8, 2.6) * height + 0.5;
      return { m, s, v, w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)) };
    });
    dust(new THREE.Vector3(c.x, SLAB_TOP, c.z), 40, 0.42, 1.6);
    let age = 0;
    effects.push(dt => {
      age += dt;
      const fade = age < 2.2 ? 1 : Math.max(0, 1 - (age - 2.2) / 0.8);
      for (const p of parts) {
        p.v.y -= 9.8 * dt;
        p.m.position.addScaledVector(p.v, dt);
        const floor = SLAB_TOP + p.s.y * 0.7;
        if (p.m.position.y < floor) {
          p.m.position.y = floor;
          p.v.y *= -0.25;
          p.v.x *= 0.5;
          p.v.z *= 0.5;
          p.w.multiplyScalar(0.5);
        }
        p.m.rotation.x += p.w.x * dt;
        p.m.rotation.y += p.w.y * dt;
        p.m.rotation.z += p.w.z * dt;
        p.m.scale.copy(p.s).multiplyScalar(fade);
      }
      if (age < 3) return true;
      scene.remove(shards);
      return false;
    });
  }

  async function play(m: Move) {
    const mover = pieces.get(m.from as Square)!;
    if (lifted === mover) lifted = null;
    pieces.delete(m.from as Square);
    const victimSq = (m.flags.includes('e') ? m.to[0] + m.from[1] : m.captured ? m.to : null) as Square | null;
    const victim = victimSq ? pieces.get(victimSq) ?? null : null;
    if (victimSq) pieces.delete(victimSq);

    const d = Math.hypot(m.to.charCodeAt(0) - m.from.charCodeAt(0), +m.to[1] - +m.from[1]);
    const dur = 0.5 + 0.07 * d;
    const jobs = [arc(mover, squarePos(m.to as Square), m.piece === 'n', dur, victim ? () => shatter(victim) : undefined)];
    if (m.flags.includes('k') || m.flags.includes('q')) {
      const rank = m.from[1];
      const [rf, rt] = (m.flags.includes('k') ? ['h', 'f'] : ['a', 'd']).map(f => (f + rank) as Square);
      const rook = pieces.get(rf)!;
      pieces.delete(rf);
      pieces.set(rt, rook);
      rook.userData.square = rt;
      jobs.push(arc(rook, squarePos(rt), false, dur));
    }
    await Promise.all(jobs);
    pieces.set(m.to as Square, mover);
    mover.userData.square = m.to;

    if (m.promotion) {
      group.remove(mover);
      const crowned = spawn(m.color, m.promotion, m.to as Square);
      crowned.scale.setScalar(0.001);
      dust(squarePos(m.to as Square), 24, 0.35, 1);
      await tween(0.5, k => crowned.scale.setScalar(Math.max(0.001, easeOutBack(k))));
    }
  }

  return {
    setBoard,
    highlight,
    hoverTile,
    lift,
    pick,
    play,
    /** One of everything this board will ever draw, for the shader warm-up. */
    warmup(): THREE.Object3D[] {
      const tile = new THREE.Mesh(TILE, tileMaterial());
      const dustMat = new THREE.PointsMaterial({ map: dustTex, transparent: true, depthWrite: false });
      return [tile, new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)), dustMat)];
    },
    /** Advances the board's effects; true while anything is still moving. */
    update(dt: number) {
      clock += dt;
      for (const t of marks.children) ((t as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime.value = clock;
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
      const changed = dirty || effects.length > 0;
      dirty = false;
      return changed;
    },
  };
}
