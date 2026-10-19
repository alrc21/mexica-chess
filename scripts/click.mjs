// Real pointer clicks on projected squares — exercises picking, not just game logic.
//   node scripts/click.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-click', base = 'http://localhost:3100'] = process.argv.slice(2);
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
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(2000);
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(3600);
// Pieces are clicked on their body (what a player aims at), targets on the ground.
const at = (sq, h) => page.evaluate((s, h) => window.__stage.project(s, h), sq, h);
const click = async (sq, h = 0) => { const p = await at(sq, h); await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.click(p.x, p.y); await sleep(120); };
const history = () => page.evaluate(() => document.querySelector('footer > span')?.textContent);
// e2→e3: the lifted pawn hides e3's centre, the case that used to deselect.
const cases = [['e2', 'e3'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']];
for (const [a, b] of cases) {
  await click(a, 0.45);
  if (a === 'g1') await page.screenshot({ path: `${out}/tiles-knight.png` });
  await click(b);
  await sleep(1400);
  console.log(`${a}→${b}:`, await history());
}
await click('c4', 0.45); await sleep(300);
await page.screenshot({ path: `${out}/tiles-bishop.png` });
await click('c4', 0.45); await click('d1', 0.45); await sleep(300);
await page.screenshot({ path: `${out}/tiles-queen.png` });
console.log('errors:', errors.length ? errors.join(' | ').slice(0, 600) : 'none');
await browser.close();
