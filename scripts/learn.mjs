// Learn, end to end with real clicks: open the lessons, solve a drill, miss then solve a fork,
// see the progress survive a reload, start a hunt against the engine; desktop and phone.
//   node scripts/learn.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-learn', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let ok = true;
const expect = (cond, what) => { console.log(`${cond ? '✓' : '✗'} ${what}`); if (!cond) ok = false; };

async function open(viewport) {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport(viewport);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(2500);
  return page;
}
const clickText = (page, text) => page.evaluate(t => {
  const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t) && getComputedStyle(b.closest('[style]') ?? b).opacity !== '0');
  el?.click();
  return !!el;
}, text);
const lessonText = page => page.evaluate(() => document.querySelector('[aria-live]')?.textContent ?? '');
const square = async (page, sq, h = 0) => {
  const p = await page.evaluate((s, h) => window.__stage.project(s, h), sq, h);
  await page.mouse.move(p.x, p.y);
  await sleep(40);
  await page.mouse.click(p.x, p.y);
  await sleep(150);
};
// A capture plays in slow motion: give it time.
const move = async (page, a, b, wait = 3000) => { await square(page, a, 0.3); await sleep(250); await square(page, b); await sleep(wait); };

// ── Desktop ───────────────────────────────────────────────────────────────
let page = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluate(() => localStorage.removeItem('mc-learn-v1'));
expect(await clickText(page, 'Learn to play'), 'intro has "Learn to play"');
await sleep(900);
await page.screenshot({ path: `${out}/1-sheet.png` });
expect(await clickText(page, 'The Teocalli'), 'pick The Teocalli');
await sleep(3600);
await page.screenshot({ path: `${out}/2-drill.png` });
await move(page, 'a1', 'a6');
await move(page, 'a6', 'f6');
await move(page, 'f6', 'f2', 3200);
const earned = page => page.evaluate(() => document.querySelector('[data-hud=lesson] [aria-label$="of 3 cacao"]')?.getAttribute('aria-label'));
const solved = await earned(page);
expect(solved === '3 of 3 cacao', `drill solved in par: ${solved}`);
await page.screenshot({ path: `${out}/3-solved.png` });

expect(await clickText(page, 'Lessons'), 'open the sheet from a lesson');
await sleep(700);
expect(await clickText(page, 'The fork'), 'pick The fork');
await sleep(2200);
await move(page, 'b5', 'a7', 900); // legal, wrong
expect((await lessonText(page)).length > 0, `a wrong move is explained: "${await lessonText(page)}"`);
await page.screenshot({ path: `${out}/4-wrong.png` });
await move(page, 'b5', 'c7', 3200); // the fork; Basalt answers Ke7
await move(page, 'c7', 'a8', 6500); // takes a Teocalli: the cinematic camera
const fork = await earned(page);
expect(fork === '2 of 3 cacao', `fork solved after one miss: ${fork}`);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mc-learn-v1')));
expect(stored?.cacao?.teocalli === 3 && stored?.cacao?.fork === 2, `progress stored: ${JSON.stringify(stored?.cacao)}`);
await page.close();

// A new visit: the progress is still there, and what was learned is written down.
page = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
expect(await clickText(page, 'Keep learning'), 'intro says "Keep learning" once there is progress');
await sleep(800);
expect(await clickText(page, 'What you know'), 'open "What you know"');
await sleep(500);
const codex = await page.evaluate(() => [...document.querySelectorAll('aside li p:last-child')].map(p => p.textContent));
expect(codex.length === 2, `codex lists the two rules learned (${codex.length})`);
await page.screenshot({ path: `${out}/5-codex.png` });
expect(await clickText(page, 'Lessons'), 'back to lessons tab');
expect(await clickText(page, 'The ladder'), 'pick the ladder (a hunt)');
await sleep(3600);
await move(page, 'a2', 'a3', 400);
const thinking = await page.evaluate(() => !!document.querySelector('.mc-breathe'));
await sleep(3000);
const hunt = await page.evaluate(() => document.querySelector('section p')?.textContent);
expect(thinking, 'the machine thinks after your move in a hunt');
console.log('  hunt status:', await page.evaluate(() => [...document.querySelectorAll('[data-hud=lesson] p.font-mono')].map(p => p.textContent).find(t => t.includes('of 11'))));
await page.close();

// ── Phone ─────────────────────────────────────────────────────────────────
page = await open({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await clickText(page, 'Keep learning');
await sleep(900);
await page.screenshot({ path: `${out}/6-phone-sheet.png` });
await clickText(page, 'The skewer');
await sleep(3800);
await page.screenshot({ path: `${out}/7-phone-lesson.png` });
await page.close();

console.log('errors:', errors.length ? errors.join(' | ').slice(0, 600) : 'none');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
