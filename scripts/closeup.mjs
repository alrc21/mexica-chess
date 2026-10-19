// Close-ups at retina scale, to judge texture and edge quality.
//   node scripts/closeup.mjs <outDir>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out = '/tmp/mc-close', query = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const p = await b.newPage();
p.on('console', m => { if (m.text().includes('[stage]')) console.log(m.text()); });
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await p.goto(`http://localhost:3100/${query}`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__game, { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
await p.evaluate(() => window.__game.start({ side: 'b', mode: 'friend', level: 'easy' }));
await new Promise(r => setTimeout(r, 3800));
await p.mouse.move(720, 500);
for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: -120 }); await new Promise(r => setTimeout(r, 80)); }
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: `${out}/zoom.png` });
await p.evaluate(() => window.__stage.setWalking(true));
await new Promise(r => setTimeout(r, 3000));
await p.screenshot({ path: `${out}/foot.png` });
await b.close().catch(() => {});
process.exit(0);
