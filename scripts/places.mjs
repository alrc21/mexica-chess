// Both places, both hours: intro, board, on foot.
//   node scripts/places.mjs <outDir> [place]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out = '/tmp/mc-places', only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const place of only ? [only] : ['tenochtitlan', 'calakmul']) {
  const p = await b.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('http://localhost:3100/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(2500);
  await p.evaluate(pl => window.__stage.setPlace(pl), place);
  await sleep(800);
  const shot = n => p.screenshot({ path: `${out}/${place}-${n}.png` });
  await shot('intro-night');
  await p.evaluate(() => window.__stage.setDay(true));
  await sleep(3000);
  await shot('intro-day');
  await p.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
  await sleep(3800);
  await shot('game-day');
  await p.evaluate(() => window.__stage.setWalking(true));
  await sleep(3000);
  await shot('foot-day');
  await p.evaluate(() => window.__stage.setDay(false));
  await sleep(3000);
  await shot('foot-night');
  await p.close();
}
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 800) : 'none');
await b.close().catch(() => {});
process.exit(0);
