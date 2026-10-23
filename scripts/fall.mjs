// The end and the start again: fool's mate (the king comes down, then his army
// falls), Take back (the army gathers itself out of its rubble), the mate again,
// then Play again (the floor mends, the winners walk home, the broken rebuild).
// Also a plain capture taken back. Shot as a strip, with long tasks counted.
//   node scripts/fall.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-fall', base = 'http://localhost:3100/'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  // The page's clock can be slowed, so a strip catches frames a screenshot is too slow for.
  const rp = performance.now.bind(performance), st = setTimeout, raf = requestAnimationFrame;
  const m = { r0: 0, v0: 0, k: 1 };
  const v = () => m.v0 + (rp() - m.r0) * m.k;
  window.__slow = k => { m.v0 = v(); m.r0 = rp(); m.k = k; };
  performance.now = v;
  window.setTimeout = (f, ms = 0, ...a) => st(f, ms / m.k, ...a);
  window.requestAnimationFrame = cb => raf(() => cb(v()));
  window.__long = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
});
const phone = !!process.env.PHONE;
await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(5000); // shards and broken slabs load after ready
await page.mouse.click(5, 5);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const move = async (a, b, settle = 1600) => { await page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b); await sleep(settle); };
// Runs `act` with the page's clock at 0.2× and shoots at the given page-time marks (ms).
const now = () => page.evaluate(() => performance.now());
const strip = async (prefix, marks, act) => {
  await page.evaluate(() => window.__slow(0.2));
  const t0 = await now();
  await page.evaluate(`void (${act})()`); // don't wait for an async verb: shoot while it plays
  for (const ms of marks) {
    while ((await now()) - t0 < ms) await sleep(20);
    await shot(`${prefix}-${String(ms).padStart(5, '0')}`);
  }
  await page.evaluate(() => window.__slow(1));
};
const footer = () => page.evaluate(() => document.querySelector('footer p')?.textContent);
const longs = async label => console.log(label, 'long tasks:', await page.evaluate(() => { const l = window.__long.splice(0); return l.length ? l.join(',') : 'none'; }));

await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3800);

// A capture, taken back: the pawn gathers itself on d5, the floor mends.
await move('e2', 'e4'); await move('d7', 'd5'); await move('e4', 'd5', 3800);
await shot('0-captured');
await strip('0-undo', [150, 350, 550, 750, 1100], () => window.__game.undo());
await move('e4', 'e5', 2600); // and the game goes on from there
await longs('capture+undo');

// Fool's mate from a fresh board.
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(4200);
for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']]) await move(a, b);
await strip('1-mate', [1500, 2600, 3400, 4600, 5200, 5800, 6400, 7400, 9500], () => { window.__game.square('d8'); window.__game.square('h4'); });
console.log('footer during the fall was checked; after:', await footer());
await longs('mate+fall');

// Take back: the whole army gathers itself.
await sleep(3000);
await strip('2-takeback', [150, 350, 550, 750, 950, 1300], () => window.__game.undo());
await longs('takeback');

// The mate again, then Play again.
await page.evaluate(() => { window.__game.square('d8'); window.__game.square('h4'); });
await sleep(12000);
await strip('3-rematch', [200, 500, 800, 1100, 1400, 1700, 2000, 2400, 3500], () => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await longs('rematch');
console.log('pieces after rematch:', await page.evaluate(() => window.__stage.board.solids().length));
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 800) : 'none');
await browser.close();
