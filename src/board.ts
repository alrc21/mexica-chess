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
type Effect = (dt: number) => boolean; // false when finished

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Markers read on pale cantera and grey andesite alike: cream with a dark edge.
const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
const mat = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false });
const MARK = {
  dot: [flat(new THREE.CircleGeometry(0.095, 40)), mat('#f2ebdd', 0.95)],
  dotEdge: [flat(new THREE.RingGeometry(0.095, 0.125, 40)), mat('#0b0a08', 0.6)],
  ring: [flat(new THREE.RingGeometry(0.425, 0.465, 72)), mat('#f2ebdd', 0.95)],
  ringEdge: [flat(new THREE.RingGeometry(0.465, 0.485, 72)), mat('#0b0a08', 0.55)],
  frame: [flat(new THREE.RingGeometry(0.6, 0.668, 4, 1, Math.PI / 4)), mat('#f2ebdd', 0.95)],
  last: [flat(new THREE.PlaneGeometry(0.97, 0.97)), mat('#f2c27a', 0.13)],
  check: [flat(new THREE.RingGeometry(0.4, 0.485, 72)), mat('#e0392b', 0.95)],
} as const;

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

  function setBoard(board: ({ square: Square; type: PieceSymbol; color: Color } | null)[][]) {
    group.clear();
    pieces.clear();
    lifted = null;
    for (const p of board.flat()) if (p) spawn(p.color, p.type, p.square);
  }

  function highlight(m: Marks) {
    marks.clear();
    const put = (key: keyof typeof MARK, sq: Square, y = 0.074) => {
      const [g, material] = MARK[key];
      const mesh = new THREE.Mesh(g, material);
      mesh.position.copy(squarePos(sq)).setY(y);
      mesh.renderOrder = 2;
      marks.add(mesh);
    };
    if (m.last) for (const sq of m.last) put('last', sq, 0.07);
    if (m.check) put('check', m.check);
    if (m.selected) put('frame', m.selected);
    for (const sq of m.moves ?? []) { put('dotEdge', sq); put('dot', sq, 0.075); }
    for (const sq of m.captures ?? []) { put('ringEdge', sq); put('ring', sq, 0.075); }
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

  // ── Picking: boxes, not triangles — cheap enough for every pointer move ──
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB_TOP);
  const box = new THREE.Box3();
  const hit = new THREE.Vector3();
  function pick(ndc: THREE.Vector2, camera: THREE.Camera): Square | null {
    ray.setFromCamera(ndc, camera);
    let best: Square | null = null;
    let bestD = Infinity;
    for (const [sq, o] of pieces) {
      box.setFromObject(o);
      if (ray.ray.intersectBox(box, hit)) {
        const d = hit.distanceTo(ray.ray.origin);
        if (d < bestD) { bestD = d; best = sq; }
      }
    }
    if (best) return best;
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const f = Math.floor(hit.x + 4);
    const r = Math.floor(4 - hit.z);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? (String.fromCharCode(97 + f) + (r + 1)) as Square : null;
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
    lifted = null;
    const mover = pieces.get(m.from as Square)!;
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
    lift,
    pick,
    play,
    update(dt: number) {
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
    },
  };
}
