// Drag and drop with a real pointer: a pawn each way, a drop on an illegal
// square (the stone floats back, still in hand, and a click then plays it),
// a capture dropped on the victim, the camera still while a stone is carried,
// and a finger on a phone.
//   node scripts/drag.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-drag', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

async function open(viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport(viewport);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(2500);
  await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
  await sleep(4000);
  const at = (sq, h = 0) => page.evaluate((s, h) => window.__stage.project(s, h), sq, h);
  const history = () => page.evaluate(() => document.querySelector('footer > span')?.textContent ?? '');
  return { page, errors, at, history };
}

// ── Mouse ────────────────────────────────────────────────────────────────
{
  const { page, errors, at, history } = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
  // Pieces are taken by the body, dropped on the ground of the square (or on the victim's body).
  const drag = async (a, b, { bh = 0, shot, still } = {}) => {
    const p = await at(a, 0.45), q = await at(b, bh);
    await page.mouse.move(p.x, p.y); await sleep(80);
    await page.mouse.down(); await sleep(120);
    await page.mouse.move(q.x, q.y, { steps: 14 }); await sleep(450);
    if (still) { const now = await at('a1'); expect(Math.hypot(now.x - still.x, now.y - still.y) < 1, `camera holds still while ${a} is carried`); }
    if (shot) await page.screenshot({ path: `${out}/${shot}.png` });
    await page.mouse.up();
  };
  const before = await at('a1');
  await drag('e2', 'e4', { shot: 'carry-pawn', still: before });
  await sleep(2900);
  expect((await history()).includes('e4'), 'e2→e4 dropped by hand');
  await drag('e7', 'e5'); await sleep(2900);
  expect((await history()).includes('e5'), 'e7→e5 dropped by hand');

  await drag('g1', 'g3'); await sleep(700); // a knight can't go there
  expect(!(await history()).includes('g3'), 'an illegal drop plays nothing');
  await page.screenshot({ path: `${out}/illegal-floats-back.png` });
  const f3 = await at('f3'); await page.mouse.click(f3.x, f3.y); await sleep(2900); // still in hand: a click finishes it
  expect((await history()).includes('Nf3'), 'after an illegal drop the stone stays in hand, a click plays it');

  await drag('d7', 'd5'); await sleep(2900);
  await drag('e4', 'd5', { bh: 0.3, shot: 'carry-onto-victim' }); await sleep(500);
  await page.screenshot({ path: `${out}/capture-by-hand.png` });
  await sleep(3500);
  expect((await history()).includes('exd5'), 'a capture dropped on the victim');
  expect(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''}`);
  await page.close();
}

// ── A finger on a phone ──────────────────────────────────────────────────
{
  const { page, errors, at, history } = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await at('d2', 0.3), q = await at('d4');
  await page.touchscreen.touchStart(p.x, p.y); await sleep(120);
  for (let i = 1; i <= 12; i++) { await page.touchscreen.touchMove(p.x + (q.x - p.x) * i / 12, p.y + (q.y - p.y) * i / 12); await sleep(16); }
  await sleep(300);
  await page.screenshot({ path: `${out}/phone-carry.png` });
  await page.touchscreen.touchEnd(); await sleep(2900);
  expect((await history()).includes('d4'), 'd2→d4 dragged with a finger');
  expect(!errors.length, `no page errors on the phone${errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''}`);
  await page.close();
}

await browser.close();
console.log(failures.length ? `${failures.length} failed` : 'all drags check out');
process.exit(failures.length ? 1 : 0);
