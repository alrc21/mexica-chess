/** A tiny tween clock: everything that moves advances from the render loop. */
type Job = { t: number; dur: number; step: (k: number) => void; done: () => void };
const jobs: Job[] = [];

export function tween(dur: number, step: (k: number) => void): Promise<void> {
  return new Promise(done => jobs.push({ t: 0, dur, step, done }));
}

export function advance(dt: number) {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    j.t += dt;
    const k = Math.min(1, j.t / j.dur);
    j.step(k);
    if (k >= 1) {
      jobs.splice(i, 1);
      j.done();
    }
  }
}

/** True while any tween is running. */
export const animating = () => jobs.length > 0;

export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOutBack = (k: number) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
export const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
