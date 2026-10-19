// The dramatic beats, shot as a strip: a bishop takes a knight (cinematic cut,
// fracture, slow motion), then fool's mate (the king collapses).
//   node scripts/drama.mjs <outDir> [query]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-drama', query = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.text().includes('[stage]')) console.log(m.text()); });
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await page.goto(`http://localhost:3100/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(4000); // shards load after ready
await page.mouse.click(5, 5); // a gesture opens the audio
if (process.env.PLACE) { await page.evaluate(p => window.__stage.setPlace(p), process.env.PLACE); await sleep(500); }
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3600);
const move = async (a, b, settle = 1500) => { await page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b); await sleep(settle); };
for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']]) await move(a, b);
await page.evaluate(() => { window.__game.square('b5'); window.__game.square('c6'); });
const t0 = Date.now();
for (const ms of [500, 900, 1150, 1350, 1600, 1900, 2400, 3200]) {
  await sleep(ms - (Date.now() - t0));
  await page.screenshot({ path: `${out}/take-${String(ms).padStart(4, '0')}.png` });
}
await sleep(3000);
await page.screenshot({ path: `${out}/take-after.png` });

await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3600);
for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']]) await move(a, b);
await page.evaluate(() => { window.__game.square('d8'); window.__game.square('h4'); });
const t1 = Date.now();
for (const ms of [1800, 2400, 2800, 3200, 3800, 6500]) {
  await sleep(ms - (Date.now() - t1));
  await page.screenshot({ path: `${out}/mate-${String(ms).padStart(4, '0')}.png` });
}
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 800) : 'none');
await browser.close();
