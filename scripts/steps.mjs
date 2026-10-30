// The intro on a phone: its choices folded into one line, opened one at a time with real taps —
// keep the stone, pick basalt, a friend (so no level), keep the place and the hour → folded again.
//   node scripts/steps.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-steps', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const errors = [], fails = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(base, { waitUntil: 'load' }); await page.waitForFunction(() => window.__game, { timeout: 60000 }); await sleep(4000);
const tap = async (sel, ...args) => { const h = await page.evaluateHandle(sel, ...args); const r = await h.asElement().boundingBox(); await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); };
const toggle = () => tap(() => document.querySelector('button[aria-expanded]'));
const option = t => tap(t => [...document.querySelectorAll('[role=radio]')].find(b => b.textContent === t && b.offsetParent), t);
const visible = () => page.evaluate(() => [...document.querySelectorAll('[role=radiogroup]')].filter(g => g.offsetParent).map(g => g.getAttribute('aria-label')));
const line = () => page.$eval('button[aria-expanded]', b => b.textContent);
await toggle(); await sleep(500);
let v = await visible(); console.log('open:', v, await line()); if (v.join() !== 'Carved in') fails.push('opens on carved in');
await page.screenshot({ path: `${out}/1-carved.png` });
for (const [pick, want] of [['Stone', 'You play'], ['Basalt', 'Against'], ['A friend', 'Place'], ['Tenochtitlan', 'Hour']]) {
  await option(pick); await sleep(1300);
  v = await visible(); console.log(`${pick} →`, v, await line()); if (v.join() !== want) fails.push(`${pick} → ${want}`);
  await page.screenshot({ path: `${out}/after-${pick.replace(' ', '-')}.png` });
}
await option('Night'); await sleep(900);
v = await visible(); const l = await line(); console.log('Night →', v, l);
if (v.length || !/Basalt.*A friend.*Night/.test(l)) fails.push('folds after the last with the choices in the line');
await page.screenshot({ path: `${out}/folded.png` });
console.log(fails.length ? 'FAIL ' + fails.join(' | ') : 'all steps check out', errors.length ? 'ERRORS ' + errors.join(' | ').slice(0, 300) : 'no errors');
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
