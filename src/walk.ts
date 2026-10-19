import * as THREE from 'three';

/**
 * On foot: the camera at a person's eye height among the pieces, so a pawn
 * stands like a shrine and the king like a pyramid. Drag to look; WASD/arrows
 * to walk (shift to hurry); or tap the ground and walk there. The pieces and
 * braziers are solid.
 */
export type Solid = { x: number; z: number; r: number };

// Board units (a square is 1): at this height the pieces read as monuments. ?eye= tunes it.
export const EYE = Number(new URLSearchParams(location.search).get('eye')) || 0.12;
const SPEED = { walk: 0.42, run: 1.05, tap: 0.75 };
const BOUND = 9.5; // stay on this side of the Templo Mayor
const SLAB_TOP = 0.06;
const floorAt = (x: number, z: number) => {
  const m = Math.max(Math.abs(x), Math.abs(z));
  return m < 4 ? SLAB_TOP : m < 4.5 ? 0.11 : 0;
};

export function createWalk(camera: THREE.PerspectiveCamera, solids: () => Solid[], step: (at: THREE.Vector3, run: boolean) => void) {
  const pos = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let floor = SLAB_TOP;
  let target: THREE.Vector3 | null = null;
  const keys = new Set<string>();
  let stride = 0;
  let bob = 0;

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) return;
    if (e.type === 'keydown') { keys.add(k); target = null; } else keys.delete(k);
  };
  const clear = () => keys.clear();

  function aim(look: THREE.Vector3) {
    const d = look.clone().sub(camera.position);
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /** Push a point out of everything solid. */
  function resolve(p: THREE.Vector3) {
    for (const s of solids()) {
      const dx = p.x - s.x, dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d < s.r && d > 1e-5) { p.x = s.x + dx / d * s.r; p.z = s.z + dz / d * s.r; }
    }
    p.x = THREE.MathUtils.clamp(p.x, -BOUND, BOUND);
    p.z = THREE.MathUtils.clamp(p.z, -BOUND, BOUND);
  }

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  return {
    /** Stand at `at` looking at `look`. */
    place(at: THREE.Vector3, look: THREE.Vector3) {
      pos.set(at.x, 0, at.z);
      resolve(pos);
      floor = floorAt(pos.x, pos.z);
      target = null;
      camera.position.set(pos.x, floor + EYE, pos.z);
      aim(look);
    },
    /** Where the eye will be once standing at `at` — for the flight down. */
    eyeAt: (at: THREE.Vector3) => new THREE.Vector3(at.x, floorAt(at.x, at.z) + EYE, at.z),
    start() { addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('blur', clear); },
    stop() { removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', clear); keys.clear(); target = null; },
    look(dx: number, dy: number) {
      yaw -= dx * 0.0042;
      pitch = THREE.MathUtils.clamp(pitch - dy * 0.0042, -1.1, 1.25);
    },
    walkTo(p: THREE.Vector3) { target = new THREE.Vector3(p.x, 0, p.z); },
    update(dt: number) {
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(-fwd.z, 0, fwd.x);
      move.set(0, 0, 0);
      const run = keys.has('shift');
      if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
      if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
      if (keys.has('d') || keys.has('arrowright')) move.add(right);
      if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
      let speed = run ? SPEED.run : SPEED.walk;
      if (move.lengthSq() > 0) move.normalize();
      else if (target) {
        move.copy(target).sub(pos).setY(0);
        const d = move.length();
        if (d < 0.04) target = null;
        else {
          move.divideScalar(d);
          speed = SPEED.tap * Math.min(1, d / 0.35 + 0.15); // ease into the stop
          // Turn gently toward where we're going.
          const want = Math.atan2(-move.x, -move.z);
          let dy = want - yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          yaw += dy * Math.min(1, dt * 2.5);
        }
      }
      const moving = move.lengthSq() > 0;
      if (moving) {
        const before = pos.clone();
        pos.addScaledVector(move, speed * dt);
        resolve(pos);
        const went = before.distanceTo(pos);
        if (target && went < speed * dt * 0.2) target = null; // walked into stone: stop
        stride += went;
        bob += went * 26;
        const cadence = run ? 0.21 : 0.13;
        if (stride > cadence) { stride = 0; step(pos, run); }
      } else bob *= 0.9;
      floor += (floorAt(pos.x, pos.z) - floor) * Math.min(1, dt * 10); // step up onto the frame
      camera.position.set(pos.x, floor + EYE + Math.sin(bob) * 0.0025, pos.z);
      euler.set(pitch, yaw, Math.sin(bob * 0.5) * 0.002);
      camera.quaternion.setFromEuler(euler);
    },
  };
}

export type Walk = ReturnType<typeof createWalk>;
