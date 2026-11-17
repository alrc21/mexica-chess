// A lost WebGL context, mid-game on a phone: the board must come back lit, not black.
// iOS can drop the GPU process (app switch, memory pressure); what then dies with it is what
// the player's screenshot showed: textures held as ImageBitmaps re-upload black. So the bitmaps
// are closed while the context is down. Then a context that never comes back must reload the page,
// and the reload must come back to the game in progress (same FEN).
//   node scripts/context.mjs <outDir> [base]      CARVE=Clay to play it in clay
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { Chess } from 'chess.js';
import fs from 'node:fs';

const [out = '/tmp/mc-context', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const errors = [], fails = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !m.text().includes('WebSocket')) errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  window.__bitmaps = [];
  const cib = window.createImageBitmap.bind(window);
  window.createImageBitmap = async (...a) => { const b = await cib(...a); window.__bitmaps.push(b); return b; };
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${base}/?phone=1`, { waitUntil: 'load' }); await page.waitForFunction(() => window.__game, { timeout: 60000 }); await sleep(3000);
// CARVE=clay: chosen in the intro as a player would, so the reload must bring it back from the saved game, not the URL.
if (process.env.CARVE) { await page.evaluate(c => [...document.querySelectorAll('[aria-label="Carved in"] button')].find(b => b.textContent === c).click(), process.env.CARVE); await sleep(4000); }
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' })); await sleep(4000);
for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) {
  await page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b); await sleep(2600);
}
await sleep(8000); // shards, broken slabs and temples load after the first frame

// Luminance of a 9x9 patch around an empty light square (d3) and a piece (the king on e1).
const at = await page.evaluate(() => [window.__stage.project('d3'), window.__stage.project('e1', 0.35)]);
const sample = async name => {
  const png = await page.screenshot({ path: `${out}/${name}.png` });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return at.map(({ x, y }) => {
    let s = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const i = ((Math.round(y * 2) + dy) * info.width + Math.round(x * 2) + dx) * info.channels;
      s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return Math.round(s / 81);
  });
};
const before = await sample('1-before');
const closed = await page.evaluate(async () => {
  const c = document.querySelector('canvas'), ext = c.getContext('webgl2').getExtension('WEBGL_lose_context');
  const lost = new Promise(r => c.addEventListener('webglcontextlost', r, { once: true }));
  ext.loseContext(); await lost;
  for (const b of window.__bitmaps) b.close();
  await new Promise(r => setTimeout(r, 500));
  const back = new Promise(r => c.addEventListener('webglcontextrestored', r, { once: true }));
  ext.restoreContext(); await back;
  return window.__bitmaps.length;
});
await sleep(3000);
const after = await sample('2-restored');
console.log(`light square d3 ${before[0]} → ${after[0]} · king e1 ${before[1]} → ${after[1]} · ImageBitmaps closed: ${closed}`);
if (before[0] < 80 || before[1] < 12) fails.push('the board was not lit before the loss: samples miss the square or the piece');
if (after[0] < before[0] * 0.8) fails.push('light square came back dark');
if (after[1] < before[1] * 0.7) fails.push('piece came back dark');

// A context the browser never gives back: the page must reload rather than stay blank, and come back
// to the same position. The saved game is tagged; only the resumed game rewriting it drops the tag.
const fen = pgn => { const c = new Chess(); c.loadPgn(pgn); return c.fen(); };
const saved = await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('mc-game')); sessionStorage.setItem('mc-game', JSON.stringify({ ...s, tag: 1 })); return s; });
const reloaded = page.waitForNavigation({ timeout: 15000 }).then(() => true, () => false);
await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
if (!(await reloaded)) fails.push('no reload after a context that stayed lost');
else {
  await page.waitForFunction(() => window.__game, { timeout: 60000 }); await sleep(7000);
  await page.screenshot({ path: `${out}/3-resumed.png` });
  const now = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mc-game') ?? 'null'));
  console.log(`stayed lost → reloaded · before ${fen(saved.pgn)} · after ${now ? fen(now.pgn) : 'no game'}`);
  if (!now || now.tag || fen(now.pgn) !== fen(saved.pgn)) fails.push('the reload did not come back to the same position');
}

console.log(fails.length ? 'FAIL ' + fails.join(' | ') : 'the board comes back', errors.length ? 'ERRORS ' + errors.join(' | ').slice(0, 300) : 'no errors');
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
