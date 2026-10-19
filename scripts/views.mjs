// The views: intro by night and day, the board by day, on foot by day and night.
//   node scripts/views.mjs <outDir> [query] [--walk-only]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-views', query = '', flag] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(`http://localhost:3100/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(2500);
const click = t => page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t).click(), t);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const walkFrom = async tag => {
  await click('Walk the board');
  await sleep(2800);
  await shot(`walk-${tag}-1`);
  // Turn the head a little to the right and walk forward.
  await page.mouse.move(720, 450); await page.mouse.down(); await page.mouse.move(600, 470, { steps: 8 }); await page.mouse.up();
  await page.keyboard.down('w'); await sleep(1800); await page.keyboard.up('w');
  await sleep(300);
  await shot(`walk-${tag}-2`);
};
if (flag !== '--walk-only') await shot('intro-night');
await click('Day');
await sleep(3200);
if (flag !== '--walk-only') await shot('intro-day');
await click('A friend');
await click('Play');
await sleep(3800);
if (flag !== '--walk-only') await shot('game-day');
await walkFrom('day');
await click('Nightfall');
await sleep(3200);
await shot('walk-night');
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 800) : 'none');
await browser.close();
