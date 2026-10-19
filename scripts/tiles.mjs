// The framing Alberto sent: close on the e-pawn with its path lit, at retina scale.
//   node scripts/tiles.mjs <out.png>
import puppeteer from 'puppeteer-core';
const [out = '/tmp/tiles.png'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await p.goto('http://localhost:3100/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__game, { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
await p.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await new Promise(r => setTimeout(r, 3800));
const at = (sq, h = 0) => p.evaluate((s, h) => window.__stage.project(s, h), sq, h);
let q = await at('e3');
await p.mouse.move(q.x, q.y);
for (let i = 0; i < 7; i++) { await p.mouse.wheel({ deltaY: -120 }); await new Promise(r => setTimeout(r, 60)); }
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__game.square('e2'));
q = await at('e4'); await p.mouse.move(q.x, q.y); // hover one target
await new Promise(r => setTimeout(r, 900));
const c = await at('e3');
await p.screenshot({ path: out, clip: { x: c.x - 260, y: c.y - 230, width: 520, height: 400 } });
await b.close().catch(() => {});
process.exit(0);
