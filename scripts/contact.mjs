// Contact shadows: the overview, a close look at the plinths on the slabs, and a lifted piece.
//   node scripts/contact.mjs <outDir> [base]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out = '/tmp/mc-contact', base = 'http://localhost:3100'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await p.goto(base, { waitUntil: 'load' });
await p.waitForFunction(() => window.__game, { timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));
await p.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await new Promise(r => setTimeout(r, 4000));
await p.screenshot({ path: `${out}/overview.png` });
await p.evaluate(() => window.__stage.frame([1.8, 0.7, 4.6], [-0.4, 0.15, 2.2], 30));
await new Promise(r => setTimeout(r, 1200));
await p.screenshot({ path: `${out}/close.png` });
await p.evaluate(() => window.__game.square('d2'));
await new Promise(r => setTimeout(r, 900));
await p.screenshot({ path: `${out}/lifted.png` });
console.log('errors:', errors.join(' | ') || 'none');
await b.close();
