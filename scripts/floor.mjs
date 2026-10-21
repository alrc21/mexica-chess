// The floor breaks where a piece dies: judged from the player's camera, mid-break and settled, then up close.
//   node scripts/floor.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-floor', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  window.__links = 0;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links++; return link.call(this, p); };
});
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(5000); // the broken slabs load after the first frame
await page.mouse.click(5, 5);
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3800);
const links0 = await page.evaluate(() => window.__links);
const move = (a, b) => page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b);
await move('e2', 'e4'); await sleep(2600);
await move('d7', 'd5'); await sleep(2600);
await move('e4', 'd5'); await sleep(900);   // pawn takes pawn: d5 cracks
await page.screenshot({ path: `${out}/1-cracking.png` });
await sleep(2500);
await page.screenshot({ path: `${out}/2-cracked.png` });
await move('d8', 'd5'); await sleep(1500);  // queen takes pawn on the same square: d5 shatters (cinematic)
await page.screenshot({ path: `${out}/3-shattering.png` });
await sleep(4500);
await move('b1', 'c3'); await sleep(2600);  // the queen is chased off d5
await move('d5', 'a5'); await sleep(3200);
await page.screenshot({ path: `${out}/4-overview.png` });
await page.mouse.move(720, 420);
for (let i = 0; i < 7; i++) { await page.mouse.wheel({ deltaY: -120 }); await sleep(80); }
await sleep(1500);
await page.screenshot({ path: `${out}/5-zoom.png` });
// Up close, low over the square (d5 is x -0.5, z -0.5), from the side the light rakes across.
await page.evaluate(() => window.__stage.frame([0.9, 0.9, 0.6], [-0.5, 0.02, -0.5], 34));
await sleep(1200);
await page.screenshot({ path: `${out}/6-close.png` });
await page.evaluate(() => window.__stage.frame([-0.5, 2.6, 1.6], [-0.5, 0.02, -0.5], 30));
await sleep(1200);
await page.screenshot({ path: `${out}/7-above.png` });
console.log('history:', await page.evaluate(() => document.querySelector('footer > span')?.textContent));
console.log('shaders linked during play:', (await page.evaluate(() => window.__links)) - links0);
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 600) : 'none');
await browser.close();
