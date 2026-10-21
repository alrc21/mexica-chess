// Clean frames (no interface) for the About page → public/stills/*.jpg
//   node scripts/about-shots.mjs [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [base = 'http://localhost:3100'] = process.argv.slice(2);
const out = 'public/stills';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.5 });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game, { timeout: 60000 });
await sleep(5000);
await page.addStyleTag({ content: '.z-10, .z-40 { display: none !important; }' }); // the stone only
const shot = name => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 80 });
const S = window => window.__stage;

await shot('templo-mayor');
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(4000);
// Low among the tezontle army, looking across at basalt.
await page.evaluate(() => window.__stage.frame([1.6, 0.55, 4.9], [-0.6, 0.3, 0.5], 34));
await sleep(1500);
await shot('pieces');
await page.evaluate(() => window.__stage.frame([0, 8.4, 11.2], [0, 0, 1.25], 30));
const move = (a, b) => page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b);
for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']]) { await move(a, b); await sleep(2900); }
await move('b5', 'c6'); // the Cuauhtli takes the Ocelotl: the cinematic cut
for (const [ms, name] of [[1150, 'blow-1'], [250, 'blow-2'], [300, 'blow-3']]) { await sleep(ms); await shot(name); }
await sleep(6000);
// A square struck twice, then left empty: d5 cracks, shatters, and the queen moves on.
await page.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await sleep(4000);
for (const [a, b, ms] of [['e2', 'e4', 2900], ['d7', 'd5', 2900], ['e4', 'd5', 3500], ['d8', 'd5', 4500], ['b1', 'c3', 2900], ['d5', 'a5', 3500]]) { await move(a, b); await sleep(ms); }
await page.evaluate(() => window.__stage.frame([0.45, 1.3, 0.85], [-0.5, 0.03, -0.5], 34));
await sleep(1500);
await shot('floor');
await page.evaluate(() => window.__game.toIntro());
await sleep(3000);
await page.evaluate(() => window.__stage.setPlace('calakmul'));
await page.evaluate(() => window.__stage.setDay(true));
await sleep(4500);
await shot('calakmul');
await browser.close();
console.log(fs.readdirSync(out).map(f => `${f} ${(fs.statSync(`${out}/${f}`).size / 1024).toFixed(0)} KB`).join('\n'));
