// Contrast on the phone's playing view (phase 10), measured on the final pixels (after ACES, bloom, fog,
// and the page's vignette and veils: Chrome's own screenshot, HUD type hidden). Each capture is paired with
// an ID render of the same frame (R = what it is, G = which piece or slab), so every number comes from a
// known piece or slab; stage.project checks the pairing.
// Stone, amber, jade × Tenochtitlan, Calakmul × night, day × seated as red, as black; at the
// starting position and after a quiet opening (no captures). Marks are cleared before each capture.
//   node scripts/contrast.mjs [tag=before]      BASE=http://localhost:3112  OUT=/tmp/mc-contrast  STONES=stone,amber,jade  POSITIONS=start,mid  (dev server up)
//   FROM=$OUT/before.json node scripts/contrast.mjs before   re-prints the tables of a saved run
// Writes docs/evidence/phase10-contrast-<tag>.jpg (colour | greyscale at 195 px), $OUT/<tag>.json; prints the tables.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const tag = process.argv[2] ?? 'before';
const BASE = process.env.BASE ?? 'http://localhost:3112';
const OUT = process.env.OUT ?? '/tmp/mc-contrast';
const STONES = (process.env.STONES ?? 'stone,amber,jade').split(',');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hashSrc = () => crypto.createHash('sha1').update(['stage', 'atmosphere', 'board'].map(f => fs.readFileSync(`src/${f}.ts`)).join('')).digest('hex').slice(0, 10);
const git = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src').toString().trim() ? '+dirty' : '');
// A quiet opening: both armies stand in the middle on both colours (e4 f3 d3 light, d4 c3 dark; e6 c6 light, d6 f6 e7 dark).
const OPENING = [['e2', 'e4'], ['d7', 'd6'], ['d2', 'd4'], ['e7', 'e6'], ['b1', 'c3'], ['g8', 'f6'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'd3'], ['f8', 'e7']];

// ── In the page ───────────────────────────────────────────────────────────────
function instrument() {
  window.WebSocket = class { addEventListener() {} removeEventListener() {} send() {} close() {} }; // no hot reload mid-run
  const hook = r => {
    const render = r.render;
    r.render = function (scene, camera) {
      if (scene.isScene && scene.fog) window.__main = { r: this, scene, camera, render };
      render.call(this, scene, camera);
      // The OutputPass has just drawn to the screen: the final frame is in the drawing buffer until this task ends.
      if (window.__want && this === window.__main?.r && this.getRenderTarget() === null) { const f = window.__want; window.__want = null; f(); }
    };
  };
  window.__THREE_DEVTOOLS__ = new EventTarget();
  window.__THREE_DEVTOOLS__.addEventListener('observe', e => { if (e.detail.isWebGLRenderer) hook(e.detail); });

  const lin = c => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const LUT = Float32Array.from({ length: 256 }, (_, i) => lin(i));
  const enc = y => Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055));
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const lab = ([r, g, b]) => {
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)].map(v => +v.toFixed(1));
  };
  const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : NaN; };
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const CLASS = { w: 1, b: 2, light: 3, dark: 4, frame: 5, bed: 6 };

  // Mean albedo of a material: base texture (sRGB → linear) × colour (TINT is folded into it), AO, roughness.
  const texMean = (img, ch) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 256, 256);
    const d = x.getImageData(0, 0, 256, 256).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] < 6) continue; // atlas padding
      s += ch === 'rgb' ? lum(LUT[d[i]], LUT[d[i + 1]], LUT[d[i + 2]]) : d[i + ch] / 255;
      n++;
    }
    return s / n;
  };

  // Step 1, inside the frame that was just shown: read the canvas back and render the ID pass.
  window.__measure = async (opts = {}) => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => /\/deps\/three\.js/.test(n));
    const T = await import(url);
    return new Promise(resolve => { window.__want = () => resolve(grab(T, opts)); });
  };

  function grab(T, opts) {
    const { r, scene, camera, render } = window.__main;
    const gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const fin = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, fin);
    let lit = 0;
    for (let i = 0; i < fin.length; i += 4) if (fin[i] + fin[i + 1] + fin[i + 2] > 30) lit++;
    if (lit < W * H * 0.2) return { error: `blank frame (${lit} lit px)` };

    // ── ID pass: same scene, same camera, flat codes, no fog, nothing translucent ─
    const pieces = [], slabs = [], saved = [], mats = new Map(), albedo = {};
    const code = (c, k) => {
      if (!mats.has(c * 256 + k)) mats.set(c * 256 + k, new T.MeshBasicMaterial({ color: new T.Color().setRGB(c * 30 / 255, k / 255, 0, T.LinearSRGBColorSpace), fog: false, toneMapped: false }));
      return mats.get(c * 256 + k);
    };
    const box = new T.Box3(), at = new T.Vector3();
    const sqAt = p => String.fromCharCode(97 + Math.round(p.x + 3.5)) + (Math.round(3.5 - p.z) + 1);
    const note = (key, m) => {
      if (!opts.albedo || albedo[key] || !m.map?.image) return;
      albedo[key] = { albedoY: +(texMean(m.map.image, 'rgb') * lum(m.color.r, m.color.g, m.color.b)).toFixed(4), colour: m.color.toArray().map(v => +v.toFixed(3)), ao: m.aoMap ? +texMean(m.aoMap.image, 0).toFixed(3) : null, roughness: +(m.roughness * (m.roughnessMap ? texMean(m.roughnessMap.image, 1) : 1)).toFixed(3) };
    };
    const fog = scene.fog, bg = scene.background, cc = r.getClearColor(new T.Color()), ca = r.getClearAlpha();
    const rt = new T.WebGLRenderTarget(W, H);
    const id = new Uint8Array(W * H * 4);
    try {
      scene.traverse(o => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        saved.push([o, o.material, o.visible]);
        const m = o.material;
        if (!o.isMesh || m.transparent) { o.visible = false; return; } // contact decals, marks, flames, dust
        let p = o; while (p && !p.userData?.square) p = p.parent;
        box.setFromObject(o).getCenter(at);
        const near = Math.abs(at.x) < 4.7 && Math.abs(at.z) < 4.7 && box.max.y < 3;
        let c = 0, k = 0;
        if (p) {
          c = CLASS[p.userData.color];
          k = pieces.push({ army: p.userData.color, type: p.userData.type, sq: p.userData.square, h: p.userData.h });
          note(`${p.userData.color === 'w' ? 'red' : 'black'} ${p.userData.type}`, m);
        } else if (near && /^slab\d/.test(o.name)) {
          c = m.name.startsWith('cantera') ? CLASS.light : CLASS.dark;
          k = slabs.push({ sq: sqAt(at), light: c === CLASS.light });
          note(m.name.startsWith('cantera') ? 'cantera slab' : 'andesite slab', m);
        } else if (near && (o.name === 'frame' || o.name === 'corner')) { c = CLASS.frame; note('basalt frame', m); }
        else if (o.geometry.parameters?.width === 8.1) c = CLASS.bed;
        o.material = code(c, k);
      });
      scene.fog = null;
      scene.background = null;
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 1);
      r.clear();
      render.call(r, scene, camera);
      r.readRenderTargetPixels(rt, 0, 0, W, H, id);
    } finally {
      for (const [o, m, v] of saved) { o.material = m; o.visible = v; }
      scene.fog = fog;
      scene.background = bg;
      r.setRenderTarget(null);
      r.setClearColor(cc, ca);
      rt.dispose();
      for (const m of mats.values()) m.dispose();
    }
    window.__cap = { W, H, fin, id, pieces, slabs, albedo, dpr: r.getPixelRatio(), cam: camera.position.toArray().map(v => +v.toFixed(2)), fov: camera.fov };
    return { ok: true };
  }

  // Step 2: the numbers, on what the page actually shows (Chrome's screenshot: canvas + the vignette and veils over it).
  window.__analyse = async (shotUrl, opts = {}) => {
    const { W, H, fin, id, pieces, slabs, albedo, dpr, cam, fov } = window.__cap;
    const bmp = await createImageBitmap(await (await fetch(shotUrl)).blob(), { colorSpaceConversion: 'none' });
    const SW = bmp.width, SH = bmp.height;
    const full = document.createElement('canvas');
    full.width = SW; full.height = SH;
    full.getContext('2d').drawImage(bmp, 0, 0);
    const shot = full.getContext('2d').getImageData(0, 0, SW, SH).data;

    // Top-down arrays at screenshot size: luminance, linear colour, the tag of every pixel (nearest ID texel).
    const N = SW * SH, Y = new Float32Array(N), RGB = new Float32Array(N * 3), key = new Int32Array(N);
    let dSum = 0, dAbs = 0, yRead = 0, nBoard = 0;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x, s = ((H - 1 - Math.floor(y * H / SH)) * W + Math.floor(x * W / SW)) * 4;
      const R = LUT[shot[i * 4]], G = LUT[shot[i * 4 + 1]], B = LUT[shot[i * 4 + 2]];
      RGB[i * 3] = R; RGB[i * 3 + 1] = G; RGB[i * 3 + 2] = B;
      Y[i] = lum(R, G, B);
      key[i] = id[s] ? Math.round(id[s] / 30) * 256 + id[s + 1] : 0;
      if (key[i]) { const yr = lum(LUT[fin[s]], LUT[fin[s + 1]], LUT[fin[s + 2]]); dSum += Y[i] - yr; dAbs += Math.abs(Y[i] - yr); yRead += yr; nBoard++; }
    }
    // Eroded masks: a pixel counts only if everything within 3 px wears the same tag (the bed shows only in seams: none).
    const groups = new Map();
    for (let y = 3; y < SH - 3; y++) for (let x = 3; x < SW - 3; x++) {
      const i = y * SW + x, k = key[i];
      if (!k) continue;
      const e = k >> 8 === CLASS.bed ? 0 : 3;
      let ok = true;
      for (let dy = -e; dy <= e && ok; dy++) for (let dx = -e; dx <= e; dx++) if (key[i + dy * SW + dx] !== k) { ok = false; break; }
      if (!ok) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const ys = idx => idx.map(i => Y[i]);
    const rgb = idx => [0, 1, 2].map(c => mean(idx.map(i => RGB[i * 3 + c])));
    const pool = c => [...groups].filter(([k]) => k >> 8 === c).flatMap(([, v]) => v);

    // Squares: each slab's own median; occupied (under a piece, contact decal included) and empty kept apart.
    const occupied = new Set(pieces.map(p => p.sq));
    const square = {};
    slabs.forEach((s, j) => {
      const idx = groups.get((s.light ? CLASS.light : CLASS.dark) * 256 + j + 1) ?? [];
      if (idx.length > 50) square[s.sq] = { light: s.light, Y: median(ys(idx)), n: idx.length, occupied: occupied.has(s.sq) };
    });
    const sqPool = (light, occ) => Object.values(square).filter(s => s.light === light && s.occupied === occ).map(s => s.Y);

    // Pieces: median (body), top and bottom luminance quartiles (bands, not faces), and where the bright band sits.
    const per = pieces.map((p, j) => {
      const k = CLASS[p.army] * 256 + j + 1, idx = groups.get(k) ?? [];
      if (idx.length < 40) return null;
      const v = ys(idx), order = idx.map((_, n) => n).sort((a, b) => v[a] - v[b]), q = Math.max(1, idx.length >> 2);
      const hi = order.slice(-q), lo = order.slice(0, q);
      const cx = mean(idx.map(i => i % SW));
      // Top silhouette edge: per column, 3–5 px inside the topmost pixel against 3–5 px above it.
      let inS = 0, outS = 0, cols = 0;
      const behind = {};
      const x0 = Math.min(...idx.map(i => i % SW)) - 4, x1 = Math.max(...idx.map(i => i % SW)) + 4;
      const y0 = Math.min(...idx.map(i => (i / SW) | 0)) - 6;
      for (let x = Math.max(0, x0); x <= Math.min(SW - 1, x1); x++) {
        let t = -1;
        for (let y = Math.max(6, y0); y < SH - 6; y++) if (key[y * SW + x] === k) { t = y; break; }
        if (t < 0) continue;
        const inside = [3, 4, 5].map(d => (t + d) * SW + x), outside = [3, 4, 5].map(d => (t - d) * SW + x);
        if (!inside.every(i => key[i] === k) || outside.some(i => key[i] === k)) continue;
        inS += mean(inside.map(i => Y[i]));
        outS += mean(outside.map(i => Y[i]));
        const name = ['other', 'red piece', 'black piece', 'cantera', 'andesite', 'frame', 'bed'][key[outside[1]] >> 8];
        behind[name] = (behind[name] ?? 0) + 1;
        cols++;
      }
      return {
        ...p, n: idx.length, body: median(v), lit: mean(hi.map(n => v[n])), shadow: mean(lo.map(n => v[n])),
        litSide: mean(hi.map(n => idx[n] % SW)) < cx ? 'left' : 'right', rgb: rgb(idx), sqY: square[p.sq]?.Y, sqLight: square[p.sq]?.light,
        edge: cols >= 3 ? { inY: inS / cols, outY: outS / cols, cols, behind: Object.entries(behind).sort((a, b) => b[1] - a[1])[0][0] } : null,
      };
    }).filter(Boolean);

    // Self-check through stage.project: the tag under each piece's mid-height is that piece.
    const css = SW / innerWidth;
    const checks = pieces.map((p, j) => {
      const s = window.__stage.project(p.sq, p.h * 0.45);
      const x = Math.round(s.x * css), y = Math.round(s.y * css);
      return x >= 0 && y >= 0 && x < SW && y < SH && key[y * SW + x] === CLASS[p.army] * 256 + j + 1;
    });

    // Images: half-size colour, and greyscale (sRGB-encoded luminance) at 195 px wide.
    const scaled = (w, grey) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round(SH * w / SW);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(full, 0, 0, c.width, c.height);
      if (grey) {
        const d = x.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = enc(lum(LUT[d.data[i]], LUT[d.data[i + 1]], LUT[d.data[i + 2]]));
        x.putImageData(d, 0, 0);
      }
      return c.toDataURL(grey ? 'image/png' : 'image/jpeg', 0.9);
    };

    const regions = { light: pool(CLASS.light), dark: pool(CLASS.dark), frame: pool(CLASS.frame), bed: pool(CLASS.bed) };
    return {
      W, H, SW, SH, dpr, cam, fov, check: `${checks.filter(Boolean).length}/${checks.length}`,
      // Screenshot against the canvas readback over the board: the veils' share (and any colour-profile shift).
      shotVsCanvas: { meanY: +(yRead / nBoard).toFixed(4), meanDelta: +(dSum / nBoard).toFixed(4), meanAbs: +(dAbs / nBoard).toFixed(4) },
      pieces: per, squares: square, albedo,
      region: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, { Y: median(ys(v)), lab: v.length ? lab(rgb(v)) : null, n: v.length }])),
      emptyY: { light: median(sqPool(true, false)), dark: median(sqPool(false, false)) },
      occupiedY: { light: median(sqPool(true, true)), dark: median(sqPool(false, true)) },
      lab: Object.fromEntries(['w', 'b'].map(a => [a, lab([0, 1, 2].map(ch => mean(per.filter(p => p.army === a).map(p => p.rgb[ch]))))])),
      mask: opts.mask ? (() => { // the ID render, for eyeballing: class in red, index in green ×3
        const m = new ImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; m.data[d] = id[s]; m.data[d + 1] = id[s + 1] * 3; m.data[d + 3] = 255; }
        const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(m, 0, 0);
        return c.toDataURL('image/png');
      })() : undefined,
      colour: scaled(Math.round(SW / 2)), grey: scaled(195, true),
    };
  };
}

// ── Contrast bookkeeping ──────────────────────────────────────────────────────
const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pairs = c => {
  const P = c.pieces, army = a => P.filter(p => p.army === a);
  const on = (a, light, t) => med(army(a).filter(p => p.sqLight === light).map(p => cr(p[t], p.sqY)));
  const body = a => med(army(a).map(p => p.body));
  const out = {};
  for (const a of ['w', 'b']) for (const [s, light] of [['cantera', true], ['andesite', false]]) for (const t of ['body', 'lit', 'shadow']) out[`${a === 'w' ? 'red' : 'black'} ${t} / own ${s}`] = on(a, light, t);
  out['red / black (body)'] = cr(body('w'), body('b'));
  out['red / black (lit band)'] = cr(med(army('w').map(p => p.lit)), med(army('b').map(p => p.lit)));
  out['cantera / andesite (empty)'] = cr(c.emptyY.light, c.emptyY.dark);
  out['frame / andesite (empty)'] = cr(c.region.frame.Y, c.emptyY.dark);
  out['black body / frame'] = cr(body('b'), c.region.frame.Y);
  // The bed shows only in 1-px seams from this camera: no pair. The top edge, split by what lies behind it.
  for (const a of ['w', 'b']) {
    const edge = (f = () => true) => med(army(a).filter(p => p.edge && f(p.edge.behind)).map(p => cr(p.edge.inY, p.edge.outY)));
    out[`${a === 'w' ? 'red' : 'black'} top edge / behind (all)`] = edge();
    for (const [name, f] of [['cantera', b => b === 'cantera'], ['andesite', b => b === 'andesite'], ['frame', b => b === 'frame'], ['a piece', b => /piece/.test(b)], ['plaza', b => b === 'other']]) out[`${a === 'w' ? 'red' : 'black'} top edge / ${name}`] = edge(f);
  }
  return out;
};
const levels = c => {
  const P = c.pieces, m = (a, t) => med(P.filter(p => p.army === a).map(p => p[t]));
  return { 'red lit': m('w', 'lit'), 'red body': m('w', 'body'), 'red shadow': m('w', 'shadow'), 'black lit': m('b', 'lit'), 'black body': m('b', 'body'), 'black shadow': m('b', 'shadow'), 'cantera empty': c.emptyY.light, 'cantera occupied': c.occupiedY.light, 'andesite empty': c.emptyY.dark, 'andesite occupied': c.occupiedY.dark, frame: c.region.frame.Y, 'bed (1-px seams, mixed)': c.region.bed.Y };
};

// ── Run ───────────────────────────────────────────────────────────────────────
// FROM=<json> re-tabulates a saved run without capturing again (no sheet).
const FROM = process.env.FROM && JSON.parse(fs.readFileSync(process.env.FROM));
const browser = FROM ? null : await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
});
const captures = FROM ? FROM.captures : [];
let noise = FROM ? FROM.noise : null;
for (const stone of FROM ? [] : STONES) {
  for (let attempt = 0; ; attempt++) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluateOnNewDocument(instrument);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const srcLoad = hashSrc();
    await page.goto(`${BASE}/?phone=1${stone === 'stone' ? '' : `&stone=${stone}`}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__main, { timeout: 90000 });
    await sleep(3500);
    // The HUD's type off; the vignette and veils under it stay: they are on the player's screen.
    await page.addStyleTag({ content: '.z-40 { display: none !important; }' });
    await page.evaluate(() => { window.__g0 = window.__game; return window.__game.start({ side: 'w', mode: 'friend', level: 'easy' }); });
    // The hour through the game's own button, so the page's veils follow it too.
    const hour = async day => {
      const want = day ? 'Nightfall' : 'Daybreak'; // the label once that hour is set
      await page.evaluate(w => { const b = [...document.querySelectorAll('button')].find(b => ['Daybreak', 'Nightfall'].includes(b.textContent.trim())); if (b.textContent.trim() !== w) b.click(); }, want);
      await page.waitForFunction(w => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === w && !b.disabled), { timeout: 15000 }, want);
      await sleep(400);
    };
    const measure = async (opts = {}) => {
      const m = await page.evaluate(o => (window.__game === window.__g0 ? window.__measure(o) : { error: 'stage remounted' }), opts);
      if (m.error) return m;
      const png = await page.screenshot({ type: 'png' });
      if (opts.name && process.env.SHOTS) fs.writeFileSync(`${OUT}/${tag}-${opts.name}.png`, png); // the phone view, full size
      return page.evaluate((u, o) => window.__analyse(u, o), `data:image/png;base64,${Buffer.from(png).toString('base64')}`, opts);
    };
    const mine = [];
    const shot = async (position, place, day, side) => {
      await page.evaluate(s => window.__stage.face(s), side);
      await page.evaluate(() => window.__stage.board.highlight({}));
      await sleep(900);
      const c = await measure({ albedo: !mine.length, mask: !mine.length && !!process.env.MASK, name: `${stone}-${position}-${place}-${day ? 'day' : 'night'}-${side === 'w' ? 'red' : 'black'}` });
      if (c.error) throw new Error(`${stone} ${position} ${place} ${day ? 'day' : 'night'} ${side}: ${c.error}`);
      if (c.mask) { fs.writeFileSync(`${OUT}/${tag}-${stone}-mask.png`, Buffer.from(c.mask.split(',')[1], 'base64')); fs.writeFileSync(`${OUT}/${tag}-${stone}-colour.jpg`, Buffer.from(c.colour.split(',')[1], 'base64')); delete c.mask; }
      mine.push({ stone, position, place, hour: day ? 'day' : 'night', side, src: srcLoad, ...c });
      console.log(stone, position, place, day ? 'day' : 'night', 'as', side === 'w' ? 'red' : 'black', 'dpr', c.dpr, 'cam', c.cam.join(','), 'project check', c.check, 'pieces', c.pieces.length, 'screen−canvas', c.shotVsCanvas.meanDelta);
    };
    try {
      for (const position of (process.env.POSITIONS ?? 'start,mid').split(',')) {
        if (position === 'mid') {
          for (const [a, b] of OPENING) { await page.evaluate((a, b) => { window.__game.square(a); window.__game.square(b); }, a, b); await sleep(2800); }
        }
        for (const place of ['tenochtitlan', 'calakmul']) {
          await page.evaluate(p => window.__stage.setPlace(p), place);
          for (const day of [false, true]) {
            await hour(day);
            for (const side of ['w', 'b']) await shot(position, place, day, side);
          }
        }
      }
      // Noise floor (fires flicker, bloom follows): the first mid-game condition again.
      if (stone === STONES[0] && mine.some(c => c.position === 'mid')) {
        await page.evaluate(() => window.__stage.setPlace('tenochtitlan'));
        await hour(false);
        await page.evaluate(() => window.__stage.face('w'));
        await sleep(900);
        const again = await measure();
        const first = mine.find(c => c.position === 'mid' && c.place === 'tenochtitlan' && c.hour === 'night' && c.side === 'w');
        const a = pairs(first), b = pairs(again);
        noise = Object.fromEntries(Object.keys(a).map(k => [k, +Math.abs(a[k] - b[k]).toFixed(3)]));
      }
      // The open page is frozen (no hot reload); an edit on disk only matters to the next page. Say so, keep the numbers.
      if (hashSrc() !== srcLoad) console.log(`warning: src changed on disk during ${stone} (this page ran ${srcLoad})`);
      console.log(stone, 'page errors:', errors.length ? errors.join(' | ').slice(0, 300) : 'none');
      captures.push(...mine);
      await page.close();
      break;
    } catch (e) {
      await page.close();
      if (attempt >= 1) throw e;
      console.log('retrying', stone, '—', e.message);
    }
  }
}

// ── Tables ────────────────────────────────────────────────────────────────────
const conds = [...new Set(captures.map(c => `${c.stone}/${c.hour}/${c.place === 'tenochtitlan' ? 'T' : 'C'}`))];
const find = (cond, position, side) => captures.find(c => `${c.stone}/${c.hour}/${c.place === 'tenochtitlan' ? 'T' : 'C'}` === cond && c.position === position && c.side === side);
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : ' – ');
const lines = [];
const table = (title, rowsOf, fmt, note) => {
  lines.push(`\n### ${title}\n${note}\n`, `| | ${conds.join(' | ')} |`, `|---|${conds.map(() => '---').join('|')}|`);
  const rows = Object.keys(rowsOf(captures[0]));
  for (const row of rows) lines.push(`| ${row} | ${conds.map(k => { const a = find(k, POS, 'w'), b = find(k, POS, 'b'); return a && b ? fmt(rowsOf(a)[row], rowsOf(b)[row], row) : ''; }).join(' | ')} |`);
};
// Seated as red, red is the near army; seated as black, it is the far one.
const nearFar = (a, b, row) => (row.startsWith('red') ? `${f2(a)}·${f2(b)}` : row.startsWith('black') ? `${f2(b)}·${f2(a)}` : `${f2(a)}·${f2(b)}`);
let POS;
for (POS of ['start', 'mid']) {
  table(`WCAG contrast, ${POS === 'start' ? 'starting position' : 'after 1.e4 d6 2.d4 e6 3.Nc3 Nf6 4.Nf3 Nc6 5.Bd3 Be7'}`, pairs, nearFar,
    'Cells: army rows = near·far (the army close to the seat, then seen from across the board); other rows = seated as red·as black. "own" square = the slab the piece stands on, contact decal included; lit/shadow = top/bottom luminance quartile of the piece\'s visible pixels.');
  table(`Relative luminance (median), ${POS}`, levels, (a, b, row) => (row.startsWith('red') ? `${(a ?? NaN).toFixed(3)}·${(b ?? NaN).toFixed(3)}` : row.startsWith('black') ? `${(b ?? NaN).toFixed(3)}·${(a ?? NaN).toFixed(3)}` : `${(a ?? NaN).toFixed(3)}·${(b ?? NaN).toFixed(3)}`), 'Same layout; WCAG relative luminance 0–1 of the final pixels.');
}
// The weakest reads: piece against its square, army against army, square against square, the top edge.
// Five distinct pairs (body against square, army against army, squares, frame, edges), each at its worst condition.
const weakest = {};
for (const c of captures) for (const [k, v] of Object.entries(pairs(c))) {
  if (!/body \/|red \/ black \(body\)|cantera \/ andesite|frame|top edge \/ behind \(all\)/.test(k) || !Number.isFinite(v) || v >= (weakest[k]?.v ?? Infinity)) continue;
  weakest[k] = { v, what: `${k} — ${c.stone} ${c.hour} ${c.place} ${c.position}, seated as ${c.side === 'w' ? 'red' : 'black'}` };
}
lines.push('\n### Five weakest pairs (each at its worst condition)\n', ...Object.values(weakest).sort((a, b) => a.v - b.v).slice(0, 5).map(c => `- ${c.v.toFixed(2)}  ${c.what}`));
// Worst and typical capture: the weakest of piece-vs-own-square (body), army-vs-army and cantera-vs-andesite.
const score = c => { const p = pairs(c); return Math.min(...Object.entries(p).filter(([k]) => /body \/ own|red \/ black \(body\)|cantera \/ andesite/.test(k)).map(([, v]) => v).filter(Number.isFinite)); };
const ranked = [...captures].sort((a, b) => score(a) - score(b));
// Typical: what most players see first, the game's defaults (stone, night, Tenochtitlan, seated as red, the opening).
const worst = ranked[0], typical = captures.find(c => c.stone === 'stone' && c.hour === 'night' && c.place === 'tenochtitlan' && c.side === 'w' && c.position === 'start') ?? ranked[ranked.length >> 1];
const label = c => `${c.stone} · ${c.hour} · ${c.place} · ${c.position} · as ${c.side === 'w' ? 'red' : 'black'}`;
lines.push(`\nWorst capture: ${label(worst)} (score ${score(worst).toFixed(2)}); typical: ${label(typical)} (${score(typical).toFixed(2)}).`);
lines.push('\n### Albedo (base texture × colour, linear luminance), AO and roughness means\n', ...Object.entries(captures.find(c => c.stone === 'stone')?.albedo ?? {}).map(([k, v]) => `- ${k}: albedo ${v.albedoY}, colour ${v.colour.join('/')}, ao ${v.ao}, roughness ${v.roughness}`));
const sv = captures.map(c => c.shotVsCanvas.meanDelta / c.shotVsCanvas.meanY);
lines.push(`\nNoise floor (same condition twice): max |Δratio| ${Math.max(...Object.values(noise ?? { x: NaN }).filter(Number.isFinite)).toFixed(3)} (${Object.entries(noise ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')})`, `Screen vs canvas over the board (vignette/veils): mean ΔY/Y from ${Math.min(...sv).toFixed(3)} to ${Math.max(...sv).toFixed(3)}`);
lines.push(`\nsrc ${FROM?.git ?? git}, stage/atmosphere/board hash per stone: ${[...new Set(captures.map(c => `${c.stone} ${c.src}`))].join(', ')}; ${captures.length} captures; dpr ${[...new Set(captures.map(c => c.dpr))].join('/')}; project self-check ${captures.map(c => c.check).filter(s => s.split('/')[0] !== s.split('/')[1]).join(' ') || 'all pass'}`);
const md = lines.join('\n');
console.log(md);
fs.writeFileSync(`${OUT}/${tag}.md`, md);
if (!FROM) fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({ tag, git, noise, captures: captures.map(({ colour, grey, ...c }) => ({ ...c, pairs: pairs(c), levels: levels(c) })) }, null, 1));

// ── Contact sheet: every starting-position capture (+ worst/typical if mid-game), colour | greyscale 195 px ─
if (FROM) process.exit(0);
const sheet = [...captures.filter(c => c.position === 'start'), ...[worst, typical].filter(c => c.position === 'mid')];
const page = await browser.newPage();
const jpg = await page.evaluate(async (cells, worstAt, typicalAt) => {
  const imgs = await Promise.all(cells.map(async c => [await createImageBitmap(await (await fetch(c.colour)).blob()), await createImageBitmap(await (await fetch(c.grey)).blob())]));
  const [cw, ch] = [imgs[0][0].width, imgs[0][0].height], gw = imgs[0][1].width, gh = imgs[0][1].height;
  const pad = 14, head = 46, per = 4, cellW = cw + gw + pad * 3, cellH = ch + head + pad;
  const c = document.createElement('canvas');
  c.width = cellW * per; c.height = cellH * Math.ceil(cells.length / per) + 40;
  const x = c.getContext('2d');
  x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#ddd'; x.font = '22px sans-serif';
  x.fillText('Phase 10 contrast: phone playing view (390×844 @2, ?phone=1). Colour (half size) | greyscale luminance at 195 px. Score = weakest of piece/own square, red/black, cantera/andesite.', pad, 28);
  cells.forEach((cell, i) => {
    const ox = (i % per) * cellW, oy = 40 + Math.floor(i / per) * cellH;
    x.fillStyle = i === worstAt ? '#c33' : i === typicalAt ? '#3a6' : '#ddd';
    x.font = '17px sans-serif';
    x.fillText(`${cell.label}${i === worstAt ? '  WORST' : i === typicalAt ? '  TYPICAL' : ''}`, ox + pad, oy + 18);
    x.fillText(`score ${cell.score}`, ox + pad, oy + 38);
    x.drawImage(imgs[i][0], ox + pad, oy + head);
    x.drawImage(imgs[i][1], ox + pad * 2 + cw, oy + head);
    if (i === worstAt || i === typicalAt) { x.strokeStyle = x.fillStyle; x.lineWidth = 4; x.strokeRect(ox + 4, oy + 2, cellW - 8, cellH - 6); }
  });
  return c.toDataURL('image/jpeg', 0.85);
}, sheet.map(c => ({ colour: c.colour, grey: c.grey, label: label(c), score: score(c).toFixed(2) })), sheet.indexOf(worst), sheet.indexOf(typical));
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync(`docs/evidence/phase10-contrast-${tag}.jpg`, Buffer.from(jpg.split(',')[1], 'base64'));
console.log(`\nsheet docs/evidence/phase10-contrast-${tag}.jpg · json ${OUT}/${tag}.json · table ${OUT}/${tag}.md`);
await browser.close();
