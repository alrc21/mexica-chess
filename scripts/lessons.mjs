// Every lesson checked: legal, solvable, par is the true minimum, tactics are the engine's choice, mates mate.
//   node scripts/lessons.mjs          (exit code 1 if any lesson is wrong)
import { Chess } from 'chess.js';
import { spawn } from 'node:child_process';
import { LESSONS } from '../src/lessons.ts';

// ── Stockfish over stdin/stdout ───────────────────────────────────────────
const sf = spawn('node', ['node_modules/stockfish/bin/stockfish-19-lite-single.js']);
let buf = '';
let wait = null;
sf.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    wait?.(line);
  }
});
const send = c => sf.stdin.write(c + '\n');
/** Best move and score (side to move's view): { best, mate } or { best, cp }. */
function analyse(fen, depth = 18) {
  return new Promise(resolve => {
    let score = {};
    wait = line => {
      const m = line.match(/score (cp|mate) (-?\d+)/);
      if (m) score = { [m[1]]: +m[2] };
      if (line.startsWith('bestmove')) { wait = null; resolve({ best: line.split(' ')[1], ...score }); }
    };
    send(`position fen ${fen}`);
    send(`go depth ${depth}`);
  });
}
// One number per score, from the side to move: a mate in n is worth a lot, sooner more.
const value = s => (s.mate !== undefined ? (s.mate > 0 ? 100000 - s.mate : -100000 - s.mate) : s.cp);
send('uci');
send('setoption name Skill Level value 20');

const load = (fen, skip) => new Chess(fen, { skipValidation: skip });
const sanOf = (fen, uci) => {
  const c = new Chess(fen);
  return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
};
const flip = fen => { const f = fen.split(' '); f[1] = 'w'; f[3] = '-'; return f.join(' '); };

/** Fewest moves to take every black stone, black never moving. */
function par(fen) {
  const black = f => f.split(' ')[0].replace(/[^a-z]/g, '').length;
  let frontier = [fen];
  const seen = new Set([fen.split(' ')[0]]);
  for (let depth = 1; depth <= 8; depth++) {
    const next = [];
    for (const f of frontier) {
      const c = load(f, true);
      for (const m of c.moves({ verbose: true })) {
        c.move(m);
        const after = flip(c.fen());
        c.undo();
        if (black(after) === 0) return depth;
        const key = after.split(' ')[0];
        if (!seen.has(key)) { seen.add(key); next.push(after); }
      }
    }
    frontier = next;
  }
  return Infinity;
}

const GOALS = {
  check: (m, c) => c.inCheck(),
  castle: m => m.flags.includes('k') || m.flags.includes('q'),
  promote: m => !!m.promotion,
  enpassant: m => m.flags.includes('e'),
  mate: (m, c) => c.isCheckmate(),
};

let bad = 0;
const fail = (l, why) => { bad++; console.log(`✗ ${l.id}: ${why}`); };
const ids = new Set();
for (const l of LESSONS) {
  if (ids.has(l.id)) fail(l, 'duplicate id');
  ids.add(l.id);
  let c;
  try { c = load(l.fen, l.kind === 'clear'); } catch (e) { fail(l, `bad FEN: ${e.message}`); continue; }
  if (c.turn() !== 'w') fail(l, 'lessons are played as Tezontle (white to move)');
  if (l.kind !== 'clear' && c.inCheck() && l.id !== 'escape') fail(l, 'starts in check');
  // Illegal if the side not to move is in check (it would mean its king could be taken).
  if (l.kind !== 'clear') { const f = l.fen.split(' '); f[1] = 'b'; f[3] = '-'; if (new Chess(f.join(' ')).inCheck()) fail(l, 'Basalt is in check with Tezontle to move: illegal'); }

  if (l.kind === 'clear') {
    const p = par(l.fen);
    if (p !== l.par) fail(l, `par is ${l.par}, true minimum ${p}`);
    else console.log(`✓ ${l.id}: clear in ${p}`);
  }

  if (l.kind === 'goal') {
    const hits = [], stale = [];
    for (const m of c.moves({ verbose: true })) {
      c.move(m);
      if (GOALS[l.goal](m, c)) hits.push(m.san);
      if (c.isStalemate()) stale.push(m.san);
      c.undo();
    }
    if (!hits.length) fail(l, `no move does "${l.goal}"`);
    else console.log(`✓ ${l.id}: ${l.goal} by ${hits.join(' ')}${stale.length ? ` · stalemates: ${stale.join(' ')}` : ''}`);
  }

  if (l.kind === 'line') {
    let fen = l.fen;
    let ok = true;
    for (const [i, step] of l.line.entries()) {
      const g = new Chess(fen);
      const legal = g.moves();
      for (const s of step.play) if (!legal.includes(s)) { fail(l, `step ${i + 1}: ${s} is not legal (${legal.join(' ')})`); ok = false; }
      if (!ok) break;
      // The accepted moves must be as good as the engine's best (within half a pawn).
      const best = await analyse(fen);
      for (const s of step.play) {
        const t = new Chess(fen);
        t.move(s);
        const after = t.isCheckmate() ? { mate: 0 } : await analyse(t.fen());
        const mine = t.isCheckmate() ? 100000 : -value(after);
        // Separate searches drift on big scores: a clearly winning move is as good as the best.
        if (s !== sanOf(fen, best.best) && mine < value(best) - 50 && !(value(best) > 800 && mine > 800)) { fail(l, `step ${i + 1}: ${s} scores ${mine}, the engine's ${sanOf(fen, best.best)} scores ${value(best)}`); ok = false; }
      }
      const t = new Chess(fen);
      t.move(step.play[0]);
      if (step.reply) {
        if (!t.moves().includes(step.reply)) { fail(l, `step ${i + 1}: reply ${step.reply} is not legal (${t.moves().join(' ')})`); ok = false; break; }
        t.move(step.reply);
      } else if (i < l.line.length - 1) { fail(l, `step ${i + 1} has no reply but more steps follow`); ok = false; }
      fen = t.fen();
    }
    if (ok) console.log(`✓ ${l.id}: line ${l.line.map(s => s.play.join('/') + (s.reply ? ` ${s.reply}` : '')).join(', ')}`);
  }

  if (l.kind === 'hunt') {
    const a = await analyse(l.fen, 24);
    if (a.mate === undefined || a.mate <= 0) fail(l, `the engine sees no mate (${JSON.stringify(a)})`);
    else if (l.within < a.mate + 3) fail(l, `within ${l.within} leaves no room: best play mates in ${a.mate}`);
    else console.log(`✓ ${l.id}: mate in ${a.mate} with best play, allowed ${l.within}`);
  }
}
sf.kill();
console.log(bad ? `\n${bad} problem(s)` : `\nall ${LESSONS.length} lessons check out`);
process.exit(bad ? 1 : 0);
