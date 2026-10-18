// Usage: node shoot.mjs <outDir> <base> route1 route2 ...   (routes like "/" or "/lampara")
// Env: VIEW=desktop|mobile|both (default both), WAIT=ms (default 3500), MOVE=1 to sweep the cursor
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [outDir, base, ...routes] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const VIEW = process.env.VIEW || 'both';
const WAIT = +(process.env.WAIT || 3500);
const views = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
for (const r of routes) {
  for (const [vname, vp] of Object.entries(views)) {
    if (VIEW !== 'both' && VIEW !== vname) continue;
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.setViewport(vp);
    await page.goto(`${base}${r}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(res => setTimeout(res, WAIT));
    if (process.env.MOVE && vname === 'desktop') {
      for (let i = 0; i <= 20; i++) { await page.mouse.move(500 + i * 22, 380 + Math.sin(i / 3) * 90); await new Promise(res => setTimeout(res, 30)); }
      await new Promise(res => setTimeout(res, 300));
    }
    const name = (r === '/' ? 'home' : r.replace(/^\//, '').replace(/[\/?=&]/g, '_')) + `-${vname}.png`;
    await page.screenshot({ path: `${outDir}/${name}` });
    console.log(name, errs.length ? 'ERRORS: ' + errs.join(' | ').slice(0, 300) : 'ok');
    await page.close();
  }
}
await browser.close();
