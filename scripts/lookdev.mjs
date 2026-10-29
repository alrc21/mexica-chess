// Lookdev (phase 9a): the same frames in stone and in each mineral, to choose
// by eye. Night and day, the two armies backlit, the whole board, two captures
// (the obsidian breaks, then the jade or amber).
//   node scripts/lookdev.mjs <outDir> [stone ...]   e.g. stone jade amber (BASE=http://localhost:3101 if 3100 is taken)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out = '/tmp/mc-lookdev', ...stones] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const stone of stones.length ? stones : ['stone']) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.5 });
  await page.goto(`${process.env.BASE ?? 'http://localhost:3100'}/${stone === 'stone' ? '' : `?stone=${stone}`}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, { timeout: 60000 });
  await sleep(5000); // shards load after ready
  await page.addStyleTag({ content: '.z-10, .z-40 { display: none !important; }' }); // the stone only
  const shot = name => page.screenshot({ path: `${out}/${stone}-${name}.jpg`, type: 'jpeg', quality: 86 });
  const set = (pos, look, fov) => page.evaluate((p, l, f) => window.__stage.frame(p, l, f), pos, look, fov);
  // Minerals run slower, so adaptive resolution steps down, and its resize puts the orbit back on the
  // game's view: frame, let shadows and resolution settle, then frame again just before the shot.
  const frame = async (pos, look, fov = 34) => { await set(pos, look, fov); await sleep(2200); await set(pos, look, fov); };
  const move = (a, b) => page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b);

  await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
  await sleep(7000); // the flight over the board must be over, or it takes the camera back
  const PIECES = [[1.6, 0.55, 4.9], [-0.6, 0.3, 0.5]]; // low among one army, looking across at the other
  await frame(...PIECES); await sleep(400); await shot('1-night');
  await page.evaluate(() => window.__stage.setDay(true)); await sleep(3200);
  await frame(...PIECES); await sleep(400); await shot('2-day');
  // The sun stands at +x +z: look toward it through each army.
  await frame([-1.5, 0.55, 0.8], [1.5, 0.3, 3.8], 38); await sleep(400); await shot('3-backlit-light');
  await frame([-3.5, 0.6, -6.5], [-0.5, 0.3, -3.5], 38); await sleep(400); await shot('4-backlit-dark');
  await frame([0, 8.4, 11.2], [0, 0, 1.25], 30); await sleep(400); await shot('5-board');
  for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']]) { await move(a, b); await sleep(2900); }
  await move('b5', 'c6'); // the bishop takes the knight: obsidian breaks
  for (const [ms, name] of [[1150, '6-take-a'], [300, '6-take-b'], [2500, '6-take-c']]) { await sleep(ms); await shot(name); }
  await sleep(3000);
  await move('d7', 'c6'); // and the pawn takes the bishop back: the light stone breaks
  for (const [ms, name] of [[1150, '7-take-a'], [300, '7-take-b'], [2500, '7-take-c']]) { await sleep(ms); await shot(name); }
  console.log(stone, 'errors:', errors.length ? errors.join(' | ').slice(0, 600) : 'none');
  await page.close();
}
await browser.close();
