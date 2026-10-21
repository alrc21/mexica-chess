// Production smoke test, any URL (no dev hooks): load, time to ready, bytes, play a move by tapping, About.
//   node scripts/smoke.mjs <outDir> https://….vercel.app
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-smoke', base = 'http://localhost:3200'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true;

for (const [name, vp] of [
  ['desktop', { width: 1440, height: 900, deviceScaleFactor: 2 }],
  ['iphone', { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
]) {
  const page = await browser.newPage();
  const errors = [];
  let bytes = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', async r => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    const len = +(r.headers()['content-length'] ?? 0);
    bytes += len;
  });
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  // Ready when the Play button can be clicked (the curtain has lifted).
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Play');
    return b && getComputedStyle(b.closest('section')).opacity === '1';
  }, { timeout: 90000 });
  const ready = (Date.now() - t0) / 1000;
  await sleep(1500);
  await page.screenshot({ path: `${out}/${name}-intro.png` });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Play').click());
  await sleep(4500);
  const status = await page.evaluate(() => document.querySelector('footer p')?.textContent);
  // Tap the e2 pawn, then e4: the overview frames the board the same way every time.
  const box = await page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { w: c.width, h: c.height }; });
  await page.screenshot({ path: `${out}/${name}-game.png` });
  console.log(`${name}: ready in ${ready.toFixed(1)} s · ${(bytes / 1e6).toFixed(1)} MB with a content-length · status "${status}" · canvas ${box.w}×${box.h}`);
  if (status !== 'Your move') ok = false;
  console.log(`  errors: ${errors.length ? errors.join(' | ').slice(0, 500) : 'none'}`);
  if (errors.length) ok = false;
  await page.close();
}

const page = await browser.newPage();
const res = await page.goto(`${base}/about`, { waitUntil: 'load' });
const title = await page.title();
console.log(`about: ${res.status()} "${title}"`);
if (res.status() !== 200 || !title.startsWith('About')) ok = false;
await browser.close();
process.exit(ok ? 0 : 1);
