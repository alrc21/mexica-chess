// End-to-end check, two players so it's deterministic: intro → Play → a capture
// (shot mid-shatter) → fool's mate → game over. Then the intro on a phone.
//   node scripts/play.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out, base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

async function open(viewport) {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport(viewport);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__game, { timeout: 30000 });
  await sleep(2500);
  return page;
}
const click = (page, text) => page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t).click(), text);
const move = async (page, from, to, settle = 1300) => {
  await page.evaluate(s => window.__game.square(s), from);
  await page.evaluate(s => window.__game.square(s), to);
  await sleep(settle);
};

const page = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
await click(page, 'A friend');
await click(page, 'Play');
await sleep(3600);
await move(page, 'e2', 'e4');
await move(page, 'd7', 'd5');
await page.evaluate(() => window.__game.square('e4'));
await page.evaluate(() => window.__game.square('d5'));
await sleep(560); await shot('1-capture-impact');
await sleep(350); await shot('2-capture-shards');
await sleep(2500); await shot('3-after-capture');
await click(page, 'New game');
await sleep(2800);
await click(page, 'Play');
await sleep(3600);
await move(page, 'f2', 'f3');
await move(page, 'e7', 'e5');
await move(page, 'g2', 'g4');
await move(page, 'd8', 'h4', 2600);
await shot('4-checkmate');

const phone = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await phone.screenshot({ path: `${out}/5-phone-intro.png` });
await click(phone, 'Play');
await sleep(4200);
await phone.screenshot({ path: `${out}/6-phone-game.png` });
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 600) : 'none');
await browser.close();
