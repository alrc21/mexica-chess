import * as THREE from 'three';

/**
 * Recorded foley (CC0, see public/audio/CREDITS.txt) through Web Audio.
 * One-shots can sit in the world: a panner places them where the stone is,
 * and the listener rides the camera, so a capture across the board sounds
 * across the board, and on foot it's right beside you.
 */
const VARIANTS = {
  grind: 3, lift: 2, thud: 3, crack: 2, crumble: 2, boom: 1, pebble: 5, step: 6,
  drum: 2, conch: 1, tick: 1, dust: 2, slab: 2,
  'fire-loop': 0, 'night-loop': 0, 'day-loop': 0, 'jungle-day-loop': 0, 'jungle-night-loop': 0, 'wind-loop': 0,
} as const;
export type Sound = keyof typeof VARIANTS;
type Opts = { at?: THREE.Vector3; gain?: number; rate?: number; delay?: number; variant?: number };
export type Loop = { gain: GainNode };

const files = (Object.entries(VARIANTS) as [Sound, number][])
  .flatMap(([name, n]) => (n ? Array.from({ length: n }, (_, i) => `${name}-${i + 1}`) : [name]));

const MUTE_KEY = 'mc-muted';
const storedMute = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const buffers = new Map<string, AudioBuffer>();
  let muted = storedMute();
  let ready: Promise<void> | null = null;
  let done = false;
  const queued: (() => void)[] = []; // loops asked for before the files arrived

  /** Browsers only let sound start inside a gesture: the first tap or click opens it. */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    // A gentle limiter so a capture next to a brazier never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 8;
    master.connect(limiter).connect(ctx.destination);
    const c = ctx;
    ready = Promise.all(files.map(async f => {
      try {
        const res = await fetch(`/audio/${f}.mp3`);
        buffers.set(f, await c.decodeAudioData(await res.arrayBuffer()));
      } catch { /* a missing or broken file is a silent sound, not a silent game */ }
    })).then(() => { done = true; for (const q of queued.splice(0)) q(); });
  }

  function pick(name: Sound, variant?: number) {
    const n = VARIANTS[name];
    return buffers.get(n ? `${name}-${variant ?? 1 + Math.floor(Math.random() * n)}` : name);
  }

  function chain(at?: THREE.Vector3, refDistance = 2.5) {
    const c = ctx!;
    const gain = c.createGain();
    if (at) {
      const p = new PannerNode(c, {
        panningModel: 'equalpower', distanceModel: 'inverse', refDistance, rolloffFactor: 1,
        positionX: at.x, positionY: at.y, positionZ: at.z,
      });
      gain.connect(p).connect(master!);
    } else gain.connect(master!);
    return gain;
  }

  function play(name: Sound, o: Opts = {}) {
    if (!ctx || !master || !done) return; // a late one-shot would land on the wrong moment
    const buffer = pick(name, o.variant);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 0.92 + Math.random() * 0.16; // no two hits alike
    const gain = chain(o.at);
    gain.gain.value = o.gain ?? 1;
    src.connect(gain);
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  /** A seamless bed (fire, night, day), optionally placed in the world. Starts silent. */
  function loop(name: Sound, at?: THREE.Vector3, refDistance = 2.5): Loop | null {
    if (!ctx) return null;
    const gain = chain(at, refDistance);
    gain.gain.value = 0;
    const start = () => {
      const buffer = pick(name);
      if (!buffer || !ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0.03; // skip the mp3 encoder's lead-in so the seam doesn't tick
      src.loopEnd = buffer.duration;
      src.connect(gain);
      src.start(ctx.currentTime, Math.random() * buffer.duration * 0.8);
    };
    if (done) start(); else queued.push(start);
    return { gain };
  }

  const fade = (l: Loop | null, to: number, seconds = 1.5) => {
    if (!l || !ctx) return;
    l.gain.gain.cancelScheduledValues(ctx.currentTime);
    l.gain.gain.setTargetAtTime(to, ctx.currentTime, seconds / 3);
  };

  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  function listen(camera: THREE.Camera) {
    if (!ctx) return;
    const l = ctx.listener;
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(camera.position.x, t);
      l.positionY.setValueAtTime(camera.position.y, t);
      l.positionZ.setValueAtTime(camera.position.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      // Older Safari: the deprecated setters.
      l.setPosition(camera.position.x, camera.position.y, camera.position.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  return {
    unlock,
    play,
    loop,
    fade,
    listen,
    get started() { return !!ctx; },
    get loaded() { return ready; },
    get muted() { return muted; },
    setMuted(m: boolean) {
      muted = m;
      try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* private mode: not remembered */ }
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.08);
    },
  };
}

export type Audio = ReturnType<typeof createAudio>;
