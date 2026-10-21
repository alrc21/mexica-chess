// Where does a click hitch? Frame gaps and long tasks around hovers, picks, moves and captures.
//   node scripts/jank.mjs [base]
import puppeteer from 'puppeteer-core';

const [base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage();
// Every shader program linked mid-game is a hitch: count them.
await page.evaluateOnNewDocument(() => {
  window.__links = [];
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links.push(performance.now()); return link.call(this, p); };
});
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(2500);
// Play is the first gesture, as for a player: it unlocks the sound.
await page.mouse.click(5, 5);
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3800);
// Frame gaps and long tasks, per labelled window.
await page.evaluate(() => {
  window.__frames = [];
  window.__long = [];
  let last = performance.now();
  const tick = t => { window.__frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false });
});
const mark = () => page.evaluate(() => performance.now());
const report = async (label, t0) => {
  const [frames, long] = await page.evaluate(() => [window.__frames, window.__long]);
  const f = frames.filter(([t]) => t >= t0).map(([, d]) => d).sort((a, b) => a - b);
  const l = long.filter(([t]) => t >= t0).map(([, d]) => Math.round(d));
  const p = q => f[Math.min(f.length - 1, Math.floor(q * f.length))]?.toFixed(1);
  const links = (await page.evaluate(() => window.__links)).filter(t => t >= t0).length;
  console.log(`${label.padEnd(26)} frames ${String(f.length).padStart(4)} · p50 ${p(0.5)} · p95 ${p(0.95)} · max ${f.at(-1)?.toFixed(1)} ms · long tasks ${l.length ? l.join(',') : '-'} · shaders linked ${links}`);
};
const at = (sq, h) => page.evaluate((s, h) => window.__stage.project(s, h), sq, h);
const click = async (sq, h = 0) => { const p = await at(sq, h); await page.mouse.move(p.x, p.y); await sleep(40); await page.mouse.click(p.x, p.y); };

let t = await mark();
await sleep(1500); await report('idle', t);

t = await mark();
for (const sq of ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'h7', 'g7', 'e7', 'd7', 'c7', 'a7']) {
  const p = await at(sq, 0.4);
  await page.mouse.move(p.x, p.y, { steps: 6 });
}
await sleep(300); await report('hover sweep', t);

t = await mark();
await click('e2', 0.45); await sleep(700); await report('pick e2', t);
t = await mark();
await click('e4'); await sleep(2800); await report('move e2-e4 + turn', t);
for (const [a, b] of [['d7', 'd5']]) { await click(a, 0.45); await sleep(200); await click(b); await sleep(2800); }
t = await mark();
await click('e4', 0.45); await sleep(200); await click('d5'); await sleep(4000); await report('pawn capture exd5', t);
for (const [a, b] of [['d8', 'd5']]) { await click(a, 0.45); await sleep(200); await click(b); await sleep(5000); }
t = await mark();
await click('b1', 0.45); await sleep(200); await click('c3'); await sleep(3000); await report('knight b1-c3 + turn', t);
t = await mark();
await click('d5', 0.45); await sleep(200); await click('a2'); await sleep(6000); await report('queen takes a2 (cinematic)', t);
t = await mark();
await sleep(2000); await report('after capture, idle', t);
console.log('history:', await page.evaluate(() => document.querySelector('footer > span')?.textContent));
await browser.close();
