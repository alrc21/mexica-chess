// Uncapped frame rate in the game view: vsync off so the number is a real budget.
//   node scripts/fps.mjs [base]
import puppeteer from 'puppeteer-core';
const base = process.argv[2] ?? 'http://localhost:3100/';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await p.goto(base, { waitUntil: 'load' });
await p.waitForFunction(() => window.__game, { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
const sample = () => p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
console.log('intro fps:', (await sample()).toFixed(1));
await p.evaluate(() => window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }));
await new Promise(r => setTimeout(r, 3500));
console.log('game fps:', (await sample()).toFixed(1));
await p.evaluate(() => window.__stage.setWalking(true));
await new Promise(r => setTimeout(r, 2800));
console.log('on foot fps:', (await sample()).toFixed(1));
await p.evaluate(() => window.__stage.setDay(true));
await new Promise(r => setTimeout(r, 3000));
console.log('on foot, day fps:', (await sample()).toFixed(1));
await b.close();
