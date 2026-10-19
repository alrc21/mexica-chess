import * as THREE from 'three';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import { easeInOut, easeOutBack, tween, wait } from './anim';
import { createRubble, type Obstacle, type Sfx } from './rubble';
import { STONE } from './lore';

export const SLAB_TOP = 0.06;
const LIFT = 0.09;
const HOVER = 0.13; // how high stone floats while it travels

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
/** The stage turns blows into camera shake and slow motion. */
export type BoardHooks = { impact(at: THREE.Vector3, power: number): void };

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

export function createBoard(scene: THREE.Scene, models: Models, sfx: Sfx, hooks: BoardHooks) {
  const group = new THREE.Group();
  const marks = new THREE.Group();
  scene.add(group, marks);
  const pieces = new Map<Square, THREE.Object3D>();
  const effects: Effect[] = [];
  const rubble = createRubble(scene, sfx);
  let lifted: THREE.Object3D | null = null;

  const heights = new Map<THREE.Object3D, number>();
  function spawn(color: Color, type: PieceSymbol, sq: Square) {
    const src = models[color][type];
    if (!heights.has(src)) heights.set(src, new THREE.Box3().setFromObject(src).max.y);
    const o = src.clone();
    o.position.copy(squarePos(sq));
    o.rotation.y = color === 'w' ? Math.PI : 0; // the armies face each other
    o.userData = { square: sq, color, type, h: heights.get(src) };
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
    if (next && next !== lifted) sfx('lift', next.position, 0.5);
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

  // ── Motion: heavy stone, moved by something stronger than hands ─────────
  const up = new THREE.Vector3(0, 1, 0);
  const lean = new THREE.Quaternion();

  /**
   * Float a piece to `to`: it rises, travels with a lag-then-lean that sells
   * the weight, and (if `land`) settles with a thud and a breath of dust.
   */
  function glide(o: THREE.Object3D, to: THREE.Vector3, dur: number, land = true) {
    const from = o.position.clone();
    const y0 = from.y;
    const flat = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    const axis = flat.lengthSq() > 1e-6 ? up.clone().cross(flat.normalize()) : null;
    const base = o.quaternion.clone();
    sfx('grind', o.position, 0.55, 0.85 + Math.random() * 0.2);
    return tween(dur, k => {
      const e = easeInOut(k);
      o.position.lerpVectors(from, to, e);
      const rise = THREE.MathUtils.smoothstep(k, 0, 0.2);
      const fall = land ? THREE.MathUtils.smoothstep(k, 0.78, 1) : 0;
      o.position.y = (y0 + (SLAB_TOP + HOVER - y0) * rise) * (1 - fall) + SLAB_TOP * fall;
      // Lags as it starts, leans in as it stops.
      if (axis) o.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, -0.09 * Math.sin(2 * Math.PI * e)));
    }).then(() => {
      o.quaternion.copy(base);
      o.position.copy(to);
      if (!land) { o.position.y = SLAB_TOP + HOVER; return; }
      o.position.y = SLAB_TOP;
      sfx('thud', o.position, 0.7);
      rubble.puff(o.position, 7, 0.55, 0.12);
      hooks.impact(o.position, 0.18);
    });
  }

  /** The knight leaps: a high arc, a slam. `onImpact` fires as it comes down. */
  function leap(o: THREE.Object3D, to: THREE.Vector3, dur: number, onImpact?: () => void) {
    const from = o.position.clone();
    const flat = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    const axis = up.clone().cross(flat);
    const base = o.quaternion.clone();
    let struck = false;
    sfx('lift', o.position, 0.7, 0.8);
    return tween(dur, k => {
      const e = easeInOut(k);
      o.position.lerpVectors(from, to, e);
      o.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * 1.0;
      o.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, 0.28 * Math.sin(Math.PI * e)));
      if (onImpact && !struck && k > 0.86) { struck = true; onImpact(); }
    }).then(() => {
      o.quaternion.copy(base);
      o.position.copy(to);
      sfx('thud', o.position, 1, 0.8);
      rubble.puff(o.position, 14, 1, 0.2);
      hooks.impact(o.position, onImpact ? 0.5 : 0.35);
    });
  }

  /** Break a placed piece: chunks of itself, thrown along the blow. */
  function shatter(victim: THREE.Object3D, blow: THREE.Vector3, power: number) {
    const { type, color } = victim.userData as { type: PieceSymbol; color: Color };
    const at = victim.position.clone().setY(0.4);
    rubble.burst(victim, type, STONE[color], blow, power);
    sfx('crack', at, 1);
    sfx('boom', at, 0.55 * power, 0.9 + Math.random() * 0.15);
    sfx('crumble', at, 0.8, undefined);
    hooks.impact(at, power);
  }

  async function play(m: Move) {
    const mover = pieces.get(m.from as Square)!;
    if (lifted === mover) lifted = null;
    pieces.delete(m.from as Square);
    const victimSq = (m.flags.includes('e') ? m.to[0] + m.from[1] : m.captured ? m.to : null) as Square | null;
    const victim = victimSq ? pieces.get(victimSq) ?? null : null;
    if (victimSq) pieces.delete(victimSq);

    const to = squarePos(m.to as Square);
    const d = Math.hypot(m.to.charCodeAt(0) - m.from.charCodeAt(0), +m.to[1] - +m.from[1]);
    const blow = new THREE.Vector3(to.x - mover.position.x, 0, to.z - mover.position.z).normalize();
    const jobs: Promise<void>[] = [];

    if (m.piece === 'n') jobs.push(leap(mover, to, 0.75 + 0.05 * d, victim ? () => shatter(victim, blow, 1.25) : undefined));
    else if (victim) jobs.push(strike(mover, victim, to, blow, d));
    else jobs.push(glide(mover, to, 0.45 + 0.1 * d));

    if (m.flags.includes('k') || m.flags.includes('q')) {
      const rank = m.from[1];
      const [rf, rt] = (m.flags.includes('k') ? ['h', 'f'] : ['a', 'd']).map(f => (f + rank) as Square);
      const rook = pieces.get(rf)!;
      pieces.delete(rf);
      pieces.set(rt, rook);
      rook.userData.square = rt;
      jobs.push(wait(120).then(() => glide(rook, squarePos(rt), 0.65)));
    }
    await Promise.all(jobs);
    pieces.set(m.to as Square, mover);
    mover.userData.square = m.to;

    if (m.promotion) {
      // The pawn bursts upward and the new piece rises out of its dust.
      rubble.burst(mover, 'p', STONE[m.color], new THREE.Vector3(), 0.55);
      sfx('crack', to, 0.7);
      sfx('drum', to, 0.9, 1);
      const crowned = spawn(m.color, m.promotion, m.to as Square);
      crowned.scale.setScalar(0.001);
      rubble.puff(to, 16, 0.9, 0.4);
      await tween(0.6, k => crowned.scale.setScalar(Math.max(0.001, easeOutBack(k))));
    }
  }

  /** Approach, rear back, lunge: the victim breaks on contact. */
  async function strike(mover: THREE.Object3D, victim: THREE.Object3D, to: THREE.Vector3, blow: THREE.Vector3, d: number) {
    const stop = to.clone().addScaledVector(blow, -0.62);
    await glide(mover, stop, 0.35 + 0.09 * Math.max(0, d - 0.62), false);
    const axis = up.clone().cross(blow);
    const base = mover.quaternion.clone();
    const shake = victim.position.clone();
    // Wind-up: the attacker rocks back, the victim shudders.
    await tween(0.2, k => {
      mover.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, -0.16 * Math.sin(k * Math.PI / 2)));
      victim.position.set(shake.x + rand(-1, 1) * 0.008 * k, shake.y, shake.z + rand(-1, 1) * 0.008 * k);
    });
    const from = mover.position.clone();
    let struck = false;
    await tween(0.16, k => {
      const e = k * k;
      mover.position.lerpVectors(from, to, e);
      mover.position.y = SLAB_TOP + HOVER * (1 - e * 0.5);
      mover.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, -0.16 + 0.42 * e));
      if (!struck && k > 0.55) { struck = true; shatter(victim, blow, 1.35); }
    });
    // Follow-through: it settles where the victim stood.
    const top = mover.position.y;
    await tween(0.34, k => {
      const e = easeInOut(k);
      mover.position.y = top + (SLAB_TOP - top) * e;
      mover.quaternion.copy(base).premultiply(lean.setFromAxisAngle(axis, 0.26 * (1 - e)));
    });
    mover.quaternion.copy(base);
    mover.position.copy(to);
    sfx('thud', to, 0.8, 0.9);
  }

  /** Checkmate: the king trembles, then comes down where he stands. */
  async function collapse(sq: Square) {
    const king = pieces.get(sq);
    if (!king) return;
    pieces.delete(sq);
    const p = king.position.clone();
    sfx('grind', p, 0.8, 0.7);
    await tween(0.9, k => {
      const a = 0.004 + 0.018 * k * k;
      king.position.set(p.x + rand(-a, a), p.y + rand(0, a * 0.5), p.z + rand(-a, a));
      king.rotation.z = rand(-1, 1) * a * 0.6;
    });
    rubble.burst(king, 'k', STONE[king.userData.color as Color], new THREE.Vector3(), 0.45);
    sfx('crack', p, 1, 0.8);
    sfx('boom', p, 1, 0.75);
    sfx('crumble', p, 1, 0.85);
    rubble.puff(p, 30, 1.6, 0.5);
    hooks.impact(p.clone().setY(0.5), 1.4);
  }

  const obstacles: Obstacle[] = [];
  return {
    setBoard,
    highlight,
    hoverTile,
    lift,
    pick,
    play,
    collapse,
    setShards: rubble.setShards,
    /** Footprints the walker can't pass through. */
    solids: () => [...pieces.values()].map(o => ({ x: o.position.x, z: o.position.z, r: 0.36 })),
    setDustColor: rubble.setDustColor,
    setParticleScale: rubble.setScale,
    /** One of everything this board will ever draw, for the shader warm-up. */
    warmup(): THREE.Object3D[] {
      return [new THREE.Mesh(TILE, tileMaterial()), ...rubble.warmup()];
    },
    /** Advances the board's effects; true while anything is still moving. */
    update(dt: number) {
      clock += dt;
      for (const t of marks.children) ((t as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime.value = clock;
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
      obstacles.length = 0;
      for (const o of pieces.values()) obstacles.push({ x: o.position.x, z: o.position.z, r: 0.3, h: o.position.y + o.userData.h });
      const rubbleBusy = rubble.update(dt, obstacles);
      const changed = dirty || rubbleBusy || effects.length > 0;
      dirty = false;
      return changed;
    },
  };
}
