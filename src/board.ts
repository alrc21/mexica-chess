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
/**
 * The stage turns blows into camera shake and slow motion, scars the slab
 * where a piece was destroyed, and heals scars when moves are taken back.
 */
export type BoardHooks = {
  impact(at: THREE.Vector3, power: number): void;
  /** Breaks the slab under `sq`; returns the bits of floor the blow throws out. */
  scar(sq: Square, ply: number, gain?: number): THREE.Object3D[];
  /** Takes back scars after `ply`: at once, or rising back level over `dur` seconds. */
  heal(ply: number, dur?: number): void;
};
type Position = ({ square: Square; type: PieceSymbol; color: Color } | null)[][];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Contact shadow: where a stone sits on the slab, the light can't get in. A
 * soft dark square a little wider than the plinth, laid on the slab under each
 * piece — it pales and spreads as the stone lifts, so a piece in the air
 * reads as in the air. The key light's shadow map carries the long shadows;
 * this carries the contact, which a shadow map is too coarse to draw.
 */
const CONTACT = (() => {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d')!;
  const img = x.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Rounded square: the plinth's footprint (±0.38 of the 1.2 decal → ±0.63 here), fading out beyond it.
    const u = Math.abs((i + 0.5) / n * 2 - 1), v = Math.abs((j + 0.5) / n * 2 - 1);
    const qx = Math.max(u - 0.52, 0), qy = Math.max(v - 0.52, 0);
    const d = Math.hypot(qx, qy) + Math.min(Math.max(u - 0.52, v - 0.52), 0);
    const a = 1 - THREE.MathUtils.smoothstep(d, -0.06, 0.46);
    const k = (j * n + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * a * a); // alphaMap reads green
    img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
})();
const CONTACT_GEO = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
const CONTACT_DARK = 0.55;
const contactMaterial = () => new THREE.MeshBasicMaterial({
  color: '#000000', alphaMap: CONTACT, transparent: true, opacity: CONTACT_DARK,
  depthWrite: false, toneMapped: false, fog: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

/**
 * Marks are whole squares of light laid on the stone, not panels on top of
 * it: an even warm wash (added light, so the grain and cracks show through),
 * a hairline inset from the edge, drawn as corner brackets for a target and
 * closed all round for the stone you hold or the square under your pointer.
 */
const TILE = new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2);
const tileMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color() },
    uFill: { value: 0 }, uLine: { value: 0 }, uFull: { value: 0 }, uPulse: { value: 0 },
    uReveal: { value: 0 }, uHover: { value: 0 }, uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // Premultiplied: the wash adds light, the hairline is laid over it.
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uFill, uLine, uFull, uPulse, uReveal, uHover, uTime;
    varying vec2 vUv;
    void main() {
      vec2 q = abs(vUv - 0.5);
      float e = 0.5 - max(q.x, q.y);                 // 0 at the edge
      float aa = fwidth(e);
      float ring = smoothstep(0.034 - aa, 0.034, e) * (1.0 - smoothstep(0.046, 0.046 + aa, e));
      float c = min(q.x, q.y);                       // how far along the edge, from its middle
      float ca = fwidth(c);
      float corner = smoothstep(0.31 - ca, 0.31, c);
      float full = max(uFull, uHover);
      float line = ring * mix(corner, 1.0, full) * uLine;
      float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 4.0);
      float wash = (uFill + uHover * 0.1) * pulse * (1.0 - line);
      vec3 rgb = uColor * wash + mix(uColor, vec3(1.0), 0.6) * line;
      gl_FragColor = vec4(rgb, line * 0.92) * uReveal;
    }`,
  transparent: true,
  depthWrite: false,
  fog: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
});
type TileKind = 'move' | 'capture' | 'selected' | 'last' | 'check';
const TILES: Record<TileKind, { color: string; fill: number; line: number; full?: boolean; pulse?: number }> = {
  move: { color: '#ffb766', fill: 0.15, line: 1 },
  capture: { color: '#ff4a22', fill: 0.24, line: 1 },
  selected: { color: '#ffd9a3', fill: 0.2, line: 1, full: true },
  last: { color: '#f2b66a', fill: 0.09, line: 0 },
  check: { color: '#ff2a1a', fill: 0.32, line: 1, full: true, pulse: 1 },
};

export function createBoard(scene: THREE.Scene, models: Models, sfx: Sfx, hooks: BoardHooks) {
  const group = new THREE.Group();
  const marks = new THREE.Group();
  scene.add(group, marks);
  const pieces = new Map<Square, THREE.Object3D>();
  const effects: Effect[] = [];
  const rubble = createRubble(scene, sfx);
  let lifted: THREE.Object3D | null = null;

  // One contact shadow per standing stone; it follows the stone until the stone is gone.
  const contacts = new Map<THREE.Object3D, THREE.Mesh>();
  const contactGroup = new THREE.Group();
  scene.add(contactGroup);
  function contact(o: THREE.Object3D, dark: number) {
    const m = new THREE.Mesh(CONTACT_GEO, contactMaterial());
    m.renderOrder = 1;
    m.userData.dark = dark;
    contactGroup.add(m);
    contacts.set(o, m);
  }
  function followContacts() {
    for (const [o, m] of contacts) {
      if (!o.parent) { // broken: its shadow goes with it
        contactGroup.remove(m);
        (m.material as THREE.Material).dispose();
        contacts.delete(o);
        continue;
      }
      const h = Math.max(0, o.position.y - SLAB_TOP);
      m.position.set(o.position.x, SLAB_TOP + 0.004, o.position.z);
      m.scale.setScalar(o.scale.x * (1 + h * 1.8));
      (m.material as THREE.MeshBasicMaterial).opacity = CONTACT_DARK * m.userData.dark * THREE.MathUtils.clamp(1 - h * 2.4, 0.18, 1);
    }
  }

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
    contact(o, src.userData.contact ?? 1); // translucent stone lets light in under itself
    return o;
  }

  let dirty = false; // pieces changed without an effect running: shadows must catch up once
  let ply = 0; // the move being played: scars and rubble remember it, so Undo can take them back
  let era = 0; // bumps when the board is set out again: an older fall or rebuild stops touching it
  let building: { board: Position; at: number } | null = null;
  /** Set out the pieces for a position `at` plies in at once; marks of later moves are taken back. */
  function setBoard(board: Position, at = 0) {
    era++;
    building = null;
    dirty = true;
    rubble.heal(at);
    hooks.heal(at);
    group.clear();
    pieces.clear();
    lifted = null;
    followContacts(); // the cleared stones take their shadows
    for (const p of board.flat()) if (p) spawn(p.color, p.type, p.square);
  }

  /**
   * Set out a position by moving the stone there: the floor mends, the stones
   * still standing walk back to their squares, the broken ones gather
   * themselves out of their own rubble. `pace` 1 for a new game, less for an
   * undo. An empty board (the first game) is set out at once.
   */
  async function rebuild(board: Position, at = 0, pace = 1) {
    if (building) setBoard(building.board, building.at); // the one under way finishes at once
    if (!pieces.size) { setBoard(board, at); return; }
    const id = ++era;
    building = { board, at };
    ply = at;
    dirty = true;
    lifted = null;
    const loose = new Map(pieces);
    pieces.clear();
    for (const o of [...group.children]) if (![...loose.values()].includes(o)) group.remove(o); // caught mid-fall
    const jobs: Promise<unknown>[] = [];
    const missing: { square: Square; type: PieceSymbol; color: Color }[] = [];
    const wanted = board.flat().filter(p => !!p);
    const same = (o: THREE.Object3D, p: { type: PieceSymbol; color: Color }) => o.userData.type === p.type && o.userData.color === p.color;
    // Already where it belongs: stays.
    const rest = wanted.filter(p => {
      const o = loose.get(p.square);
      if (!o || !same(o, p)) return true;
      loose.delete(p.square);
      pieces.set(p.square, o);
      return false;
    });
    // Standing elsewhere: the nearest of its kind walks back.
    let n = 0;
    for (const p of rest) {
      const to = squarePos(p.square);
      let best: Square | null = null;
      for (const [sq, o] of loose) if (same(o, p) && (!best || o.position.distanceTo(to) < loose.get(best)!.position.distanceTo(to))) best = sq;
      if (!best) { missing.push(p); continue; }
      const o = loose.get(best)!;
      loose.delete(best);
      pieces.set(p.square, o);
      o.userData.square = p.square;
      jobs.push(carry(o, to, (0.1 + 0.05 * n++) * pace, 0.9 * pace, id));
    }
    // Left over (a crowned pawn taken back): it sinks into the floor.
    for (const o of loose.values()) jobs.push(sink(o, 0.5 * pace, id));
    // The floor mends, and the broken stone gathers itself, from the middle of the board out.
    const mend = 0.8 * pace;
    hooks.heal(at, mend);
    jobs.push(rubble.gather(at, missing.map(p => {
      const to = squarePos(p.square);
      return { type: p.type, stone: STONE[p.color], source: models[p.color][p.type], at: to, rot: p.color === 'w' ? Math.PI : 0, delay: (0.3 + 0.25 * Math.max(0, Math.hypot(to.x, to.z) - 2.4)) * pace };
    }), pace, mend, i => {
      if (id !== era) return;
      const p = missing[i];
      const o = spawn(p.color, p.type, p.square);
      sfx('thud', o.position, 0.35, 1.3);
      rubble.puff(o.position, 5, 0.35, 0.1);
    }));
    await Promise.all(jobs);
    if (id === era) building = null;
  }

  /** A stone walking home on a low arc: no blow, no shake. */
  function carry(o: THREE.Object3D, to: THREE.Vector3, delay: number, dur: number, id: number) {
    const from = o.position.clone();
    const h = 0.2 + 0.08 * from.distanceTo(to);
    let started = false;
    return tween(delay + dur, k => {
      if (id !== era) return;
      const e = easeInOut(THREE.MathUtils.clamp((k * (delay + dur) - delay) / dur, 0, 1));
      if (e > 0 && !started) { started = true; sfx('grind', from, 0.25, rand(0.85, 1.1)); }
      o.position.lerpVectors(from, to, e);
      o.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * h;
    });
  }

  function sink(o: THREE.Object3D, dur: number, id: number) {
    const s0 = o.scale.clone();
    rubble.puff(o.position, 10, 0.6, 0.2);
    sfx('crumble', o.position, 0.4, 1.2);
    return tween(dur, k => {
      if (id !== era) return;
      o.scale.copy(s0).multiplyScalar(Math.max(0.001, 1 - k * k));
      if (k === 1) group.remove(o);
    });
  }

  /**
   * Checkmate takes the whole army: after the king, his stones go down one
   * after another, out from where he fell — each one shudders, tips away from
   * him and breaks as it goes over, and the slab it stood on cracks.
   */
  async function fall(color: Color, from: Square, at: number) {
    ply = at;
    const id = era;
    const origin = squarePos(from);
    const army = [...pieces.values()].filter(o => o.userData.color === color)
      .map(o => ({ o, d: Math.hypot(o.position.x - origin.x, o.position.z - origin.z) }));
    await Promise.all(army.map(({ o, d }) => topple(o, origin, 0.2 + 0.13 * d + rand(0, 0.06), id)));
    await tween(1.1, () => {}); // a breath while the last of it comes to rest
  }

  async function topple(o: THREE.Object3D, origin: THREE.Vector3, delay: number, id: number) {
    await tween(delay, () => {});
    if (id !== era || o.parent !== group) return;
    const { type, color, square, h } = o.userData as { type: PieceSymbol; color: Color; square: Square; h: number };
    pieces.delete(square);
    const p0 = o.position.clone();
    const dir = p0.clone().sub(origin).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    const axis = up.clone().cross(dir);
    const base = o.quaternion.clone();
    const edge = p0.clone().addScaledVector(dir, 0.34); // it pivots on the plinth's far edge
    sfx('grind', p0, 0.3, rand(0.7, 0.85));
    // It loses its footing…
    await tween(0.24, k => {
      if (id !== era) return;
      const a = 0.006 * k;
      o.position.set(p0.x + rand(-a, a), p0.y, p0.z + rand(-a, a));
    });
    if (id !== era || o.parent !== group) return;
    // …and goes over, faster and faster.
    const q = new THREE.Quaternion();
    await tween(0.3 + 0.2 * h, k => {
      if (id !== era) return;
      q.setFromAxisAngle(axis, 0.85 * k * k);
      o.quaternion.copy(base).premultiply(q);
      o.position.copy(p0).sub(edge).applyQuaternion(q).add(edge);
    });
    if (id !== era || o.parent !== group) return;
    // It breaks partway down; the slab it stood on cracks as its foot tears out.
    rubble.burst(o, type, STONE[color], dir, 1.3, ply, true);
    rubble.fling(hooks.scar(square, ply, 0.35), dir, 0.35, ply);
    const at = p0.clone().addScaledVector(dir, 0.4).setY(0.3);
    sfx('crack', at, 0.45, rand(0.85, 1.1));
    sfx('thud', at, 0.5, rand(0.75, 0.95));
    hooks.impact(at, 0.12);
  }

  // Tiles light up in a wave running out from the selected piece along its paths.
  const tiles = new Map<Square, THREE.Mesh>();
  let hovered: THREE.Mesh | null = null;
  let clock = 0;
  let wave = 0; // a new highlight retires the previous wave
  // Tiles are pooled: disposing their material would release its program and
  // the next selection would compile it again — a hitch on every click.
  const spare: THREE.Mesh[] = [];
  function highlight(m: Marks) {
    for (const t of marks.children) spare.push(t as THREE.Mesh);
    marks.clear();
    tiles.clear();
    hovered = null;
    const origin = m.selected ? squarePos(m.selected) : null;
    const put = (kind: TileKind, sq: Square, y: number) => {
      const spec = TILES[kind];
      const mesh = spare.pop() ?? new THREE.Mesh(TILE, tileMaterial());
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uHover.value = 0;
      u.uColor.value.set(spec.color);
      u.uFill.value = spec.fill;
      u.uLine.value = spec.line;
      u.uFull.value = spec.full ? 1 : 0;
      u.uPulse.value = spec.pulse ?? 0;
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
    const { type, color, square } = victim.userData as { type: PieceSymbol; color: Color; square: Square };
    const at = victim.position.clone().setY(0.4);
    rubble.burst(victim, type, STONE[color], blow, power, ply);
    rubble.fling(hooks.scar(square, ply), blow, power, ply);
    sfx('crack', at, 1);
    sfx('boom', at, 0.55 * power, 0.9 + Math.random() * 0.15);
    sfx('crumble', at, 0.8, undefined);
    hooks.impact(at, power);
  }

  async function play(m: Move, at: number) {
    ply = at;
    const mover = pieces.get(m.from as Square)!;
    if (lifted === mover) lifted = null;
    pieces.delete(m.from as Square);
    mover.userData.square = m.to; // a click on the stone in flight picks it up where it's going
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
      rubble.burst(mover, 'p', STONE[m.color], new THREE.Vector3(), 0.55, ply);
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
  async function collapse(sq: Square, at: number) {
    ply = at;
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
    rubble.burst(king, 'k', STONE[king.userData.color as Color], new THREE.Vector3(), 0.45, ply);
    rubble.fling(hooks.scar(sq, ply), new THREE.Vector3(), 1, ply);
    sfx('crack', p, 1, 0.8);
    sfx('boom', p, 1, 0.75);
    sfx('crumble', p, 1, 0.85);
    rubble.puff(p, 30, 1.6, 0.5);
    hooks.impact(p.clone().setY(0.5), 1.4);
  }

  const obstacles: Obstacle[] = [];
  return {
    setBoard,
    rebuild,
    fall,
    highlight,
    hoverTile,
    lift,
    pick,
    play,
    collapse,
    setShards: rubble.setShards,
    setEdge: rubble.setEdge,
    /** The models changed what they're carved in: the standing pieces (and their shadows) follow. */
    redress() {
      for (const o of pieces.values()) {
        const src = models[o.userData.color as Color][o.userData.type as PieceSymbol];
        const mat = (src.getObjectByProperty('isMesh', true) as THREE.Mesh).material;
        o.traverse(c => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = mat; });
        const shadow = contacts.get(o);
        if (shadow) shadow.userData.dark = src.userData.contact ?? 1;
      }
      dirty = true;
    },
    /** Footprints the walker can't pass through. */
    solids: () => [...pieces.values()].map(o => ({ x: o.position.x, z: o.position.z, r: 0.36 })),
    setDustColor: rubble.setDustColor,
    setParticleScale: rubble.setScale,
    /** One of everything this board will ever draw, for the shader warm-up. */
    warmup(): THREE.Object3D[] {
      return [new THREE.Mesh(TILE, tileMaterial()), new THREE.Mesh(CONTACT_GEO, contactMaterial()), ...rubble.warmup()];
    },
    /** Advances the board's effects; true while anything is still moving. */
    update(dt: number) {
      clock += dt;
      for (const t of marks.children) ((t as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime.value = clock;
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
      followContacts();
      obstacles.length = 0;
      for (const o of pieces.values()) obstacles.push({ x: o.position.x, z: o.position.z, r: 0.3, h: o.position.y + o.userData.h });
      const rubbleBusy = rubble.update(dt, obstacles);
      const changed = dirty || rubbleBusy || effects.length > 0;
      dirty = false;
      return changed;
    },
  };
}
