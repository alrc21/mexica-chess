import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { wait } from './anim';
import type { Engine, Level } from './engine';
import { cacaoFor, type Goal, type Lesson } from './lessons';
import { LORE, SIDE } from './lore';
import type { Hit } from './board';
import type { Stage } from './stage';

export type Settings = { side: Color; mode: 'machine' | 'friend'; level: Level };

export type View = {
  phase: 'intro' | 'playing' | 'over' | 'lesson';
  settings: Settings;
  turn: Color;
  thinking: boolean;
  check: boolean;
  status: string;
  last: string | null;
  result: { title: string; detail: string } | null;
  promoting: boolean;
  hover: { name: string; role: string; side: string } | null;
  canUndo: boolean;
  lesson: {
    id: string;
    feedback: { tone: 'good' | 'bad'; text: string } | null;
    /** Cacao earned, once solved. */
    solved: number | null;
    failed: boolean;
    moves: number;
  } | null;
};

const GOALS: Record<Goal, (m: Move, after: Chess) => boolean> = {
  check: (_, c) => c.inCheck(),
  castle: m => m.flags.includes('k') || m.flags.includes('q'),
  promote: m => !!m.promotion,
  enpassant: m => m.flags.includes('e'),
  mate: (_, c) => c.isCheckmate(),
};
/** Basalt never moves in a drill: after each move the turn comes straight back. */
const backToWhite = (fen: string) => { const f = fen.split(' '); f[1] = 'w'; f[3] = '-'; return f.join(' '); };

/**
 * One game: chess.js keeps the rules, the stage shows them, the engine plays
 * the other side. The UI only reads `View` and calls the verbs below.
 */
export function createGame(stage: Stage, engine: Engine, emit: (v: View) => void) {
  const chess = new Chess();
  let settings: Settings = { side: 'w', mode: 'machine', level: 'medium' };
  let phase: View['phase'] = 'intro';
  let busy = false; // animating or flying: input waits
  let thinking = false;
  let selected: Square | null = null;
  let targets: Move[] = [];
  let promoting: { from: Square; to: Square } | null = null;
  let hover: View['hover'] = null;
  let queued: Square | null = null; // a target clicked mid-animation, played when it lands
  let generation = 0; // bumps on undo/new game so a late engine reply is ignored
  // A lesson in progress: always played as Tezontle; Basalt answers from the script or the engine.
  let lesson: Lesson | null = null;
  let ls = { step: 0, moves: 0, mistakes: 0, hinted: false, ply: 0, solved: null as number | null, failed: false };
  let feedback: NonNullable<View['lesson']>['feedback'] = null;

  const machineTurn = () => !lesson && settings.mode === 'machine' && chess.turn() !== settings.side;
  // Whose pieces the player may pick up: their own army, even while the machine thinks.
  const mine = () => (lesson ? 'w' : settings.mode === 'machine' ? settings.side : chess.turn());
  const live = () => phase === 'playing' || phase === 'lesson';
  const lessonOpen = () => !lesson || (ls.solved === null && !ls.failed && chess.turn() === 'w');
  const canMove = () => live() && !busy && !thinking && !promoting && !machineTurn() && lessonOpen();

  function result(): View['result'] {
    if (chess.isCheckmate()) {
      const winner: Color = chess.turn() === 'w' ? 'b' : 'w';
      const moves = Math.ceil(chess.history().length / 2);
      const title = settings.mode === 'friend' ? `${SIDE[winner]} wins` : winner === settings.side ? 'You win' : 'The machine wins';
      return { title, detail: `Checkmate in ${moves} moves.` };
    }
    if (!chess.isDraw() && !chess.isStalemate()) return null;
    const why = chess.isStalemate() ? 'Stalemate.'
      : chess.isThreefoldRepetition() ? 'Threefold repetition.'
        : chess.isInsufficientMaterial() ? 'Not enough stone left to mate.'
          : 'Fifty moves without a capture or a pawn move.';
    return { title: 'Draw', detail: why };
  }

  function status() {
    if (phase === 'over') return result()?.title ?? '';
    if (thinking) return `${SIDE[chess.turn()]} is thinking`;
    if (chess.isCheckmate()) return 'Checkmate';
    if (chess.inCheck()) return settings.mode === 'machine' && !machineTurn() ? 'Check — your move' : `Check — ${SIDE[chess.turn()]} to move`;
    return settings.mode === 'machine' ? 'Your move' : `${SIDE[chess.turn()]} to move`;
  }

  function lastMove() {
    const h = chess.history();
    if (!h.length) return null;
    const n = Math.ceil(h.length / 2);
    return h.length % 2 ? `${n}. ${h[h.length - 1]}` : `${n}… ${h[h.length - 1]}`;
  }

  const publish = () => emit({
    phase,
    settings,
    turn: chess.turn(),
    thinking,
    check: chess.inCheck(),
    status: status(),
    last: lastMove(),
    result: phase === 'over' ? result() : null,
    promoting: !!promoting,
    hover,
    canUndo: phase !== 'intro' && !lesson && !busy && chess.history().length > (settings.mode === 'machine' && settings.side === 'b' ? 1 : 0),
    lesson: lesson && { id: lesson.id, feedback, solved: ls.solved, failed: ls.failed, moves: ls.moves },
  });

  function kingSquare(c: Color): Square | null {
    for (const row of chess.board()) for (const p of row) if (p?.type === 'k' && p.color === c) return p.square;
    return null;
  }

  function marks() {
    const last = chess.history({ verbose: true }).at(-1);
    stage.board.highlight({
      selected,
      moves: [...new Set(targets.filter(m => !m.captured).map(m => m.to))],
      captures: [...new Set(targets.filter(m => m.captured).map(m => m.to))],
      last: last ? [last.from, last.to] : null,
      check: chess.inCheck() && !chess.isCheckmate() ? kingSquare(chess.turn()) : null, // a mated king is rubble
    });
  }

  function deselect() {
    queued = null;
    selected = null;
    targets = [];
    stage.board.lift(null);
  }

  /**
   * A lifted or tall piece hides the squares behind it, so a legal target on
   * the ground beats the stone in front of it — unless that stone is a capture.
   */
  const isTarget = (sq: Square | null) => !!sq && targets.some(m => m.to === sq);
  const resolve = (h: Hit) => (isTarget(h.ground) && !isTarget(h.piece) ? h.ground : h.piece ?? h.ground);

  /** After the other side moves, a piece the player had picked up shows its moves again. */
  function reselect() {
    if (!selected) return;
    const p = chess.get(selected);
    if (!p || p.color !== mine()) deselect();
    else targets = chess.moves({ square: selected, verbose: true });
  }

  async function apply(m: string | { from: string; to: string; promotion?: string }, byMachine = false) {
    let move: Move;
    try { move = chess.move(m); } catch {
      console.error('illegal move', m, chess.fen());
      return;
    }
    busy = true;
    if (!byMachine) { selected = null; targets = []; } else targets = [];
    stage.board.highlight({ selected });
    if (lesson) feedback = null;
    publish();
    if (lesson) {
      await stage.play(move, ++ls.ply);
      busy = false;
      await after(move, byMachine);
      if (queued && canMove()) { const q = queued; queued = null; game.square(q); }
      return;
    }
    // Two players at one screen: the board turns to whoever moves next.
    const facing = settings.mode === 'friend' && !chess.isGameOver() ? chess.turn() : undefined;
    const g = generation;
    const ply = chess.history().length;
    await stage.play(move, ply, facing);
    if (chess.isCheckmate()) {
      // The mated king comes down where he stands, his army goes down with him,
      // and the conch sounds over the plaza.
      deselect();
      stage.board.highlight({});
      const loser = chess.turn();
      const king = kingSquare(loser);
      if (king) await stage.collapse(king, ply);
      if (king && g === generation) await stage.board.fall(loser, king, ply);
      if (g === generation) stage.audio.play('conch', { gain: 0.55 });
    } else if (chess.inCheck()) stage.audio.play('drum', { gain: 0.85, variant: 1 });
    if (g !== generation) return; // left or started over while the stone was moving
    busy = false;
    if (chess.isGameOver()) { phase = 'over'; deselect(); } else reselect();
    marks();
    publish();
    if (phase === 'playing' && machineTurn()) machine();
    else if (queued) { const q = queued; queued = null; game.square(q); }
  }

  // ── Lessons ────────────────────────────────────────────────────────────
  const sim = () => new Chess(chess.fen(), { skipValidation: lesson?.kind === 'clear' });
  /** Before a move lands: is it the lesson's answer? A wrong move never touches the board. */
  function judge(m: { from: string; to: string; promotion?: string }): string | null {
    const l = lesson!;
    if (l.kind === 'clear' || l.kind === 'hunt') return null;
    const t = sim();
    const mv = t.move(m);
    const right = l.kind === 'goal' ? GOALS[l.goal!](mv, t) : l.line![ls.step].play.includes(mv.san);
    if (right) return null;
    if (t.isStalemate()) return 'Stalemate: he has no move and isn’t in check. That’s a draw — try again.';
    return l.wrong ?? 'Not that one. Look again.';
  }
  function attempt(m: { from: string; to: string; promotion?: string }) {
    const why = lesson && judge(m);
    if (!why) { apply(m); return; }
    ls.mistakes++;
    feedback = { tone: 'bad', text: why };
    stage.audio.play('thud', { gain: 0.35, rate: 0.7 });
    deselect();
    marks();
    publish();
  }
  function solve() {
    const l = lesson!;
    ls.solved = cacaoFor(ls.mistakes, ls.hinted, l.kind === 'clear' ? ls.moves - (l.par ?? ls.moves) : 0);
    feedback = { tone: 'good', text: l.learned };
    deselect();
    stage.board.highlight({});
    stage.audio.play('drum', { gain: 0.75, variant: 2 });
    publish();
  }
  function fail(text: string) {
    ls.failed = true;
    feedback = { tone: 'bad', text };
    deselect();
    marks();
    publish();
  }
  async function after(move: Move, byMachine: boolean) {
    const l = lesson!;
    const g = generation;
    if (byMachine) {
      if (l.kind === 'hunt' && chess.isGameOver()) { fail('A draw. The hunt starts again.'); return; }
      reselect();
      marks();
      publish();
      return;
    }
    ls.moves++;
    if (l.kind === 'clear') {
      if (!chess.board().flat().some(p => p?.color === 'b')) { solve(); return; }
      chess.load(backToWhite(chess.fen()), { skipValidation: true });
      reselect(); // picked up while it was still moving: now its moves can show
      marks();
      publish();
      return;
    }
    if (l.kind === 'goal') { solve(); return; }
    if (l.kind === 'line') {
      const step = l.line![ls.step++];
      if (!step.reply) { if (ls.step >= l.line!.length) solve(); return; }
      marks();
      publish();
      await wait(450);
      if (g === generation) await apply(step.reply, true);
      return;
    }
    // hunt
    if (chess.isCheckmate()) { solve(); return; }
    if (chess.isGameOver()) { fail(chess.isStalemate() ? 'Stalemate: he has no move and isn’t in check. A draw — try again.' : 'A draw. Try again.'); return; }
    if (ls.moves >= l.within!) { fail(`He held out for ${l.within} moves. Try again — close the net tighter.`); return; }
    marks();
    publish();
    machine();
  }

  async function machine() {
    thinking = true;
    publish();
    const g = generation;
    const [uci] = await Promise.all([engine.best(chess.fen(), lesson ? 'hard' : settings.level), wait(500)]);
    if (g !== generation || !live()) return;
    thinking = false;
    await apply({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }, true);
  }

  const game = {
    async start(s: Settings) {
      settings = s;
      lesson = null;
      generation++;
      engine.stop();
      engine.newGame();
      chess.reset();
      deselect();
      promoting = null;
      thinking = false;
      phase = 'playing';
      busy = true;
      // The last game's stone walks home and gathers itself while the camera comes round.
      const rebuilt = stage.board.rebuild(chess.board(), 0);
      stage.board.highlight({});
      publish();
      // Play may be the very first gesture: the conch waits for the sounds to arrive.
      stage.audio.loaded?.then(() => stage.audio.play('conch', { gain: 0.5 }));
      await Promise.all([rebuilt, stage.toGame(s.mode === 'friend' ? chess.turn() : s.side)]);
      busy = false;
      marks();
      publish();
      if (machineTurn()) machine();
    },

    /** A click on the board. True if it picked up a piece or moved one (on foot, anything else walks). */
    click(h: Hit): boolean {
      const sq = resolve(h);
      return sq ? game.square(sq) : false;
    },

    square(sq: Square): boolean {
      if (!live() || promoting) return false;
      const options = targets.filter(m => m.to === sq);
      if (selected && options.length && busy) { queued = sq; return true; } // clicked while stone was still moving
      if (selected && options.length && canMove()) {
        if (options.some(m => m.promotion)) {
          promoting = { from: selected, to: sq };
          publish();
          return true;
        }
        attempt({ from: selected, to: sq });
        return true;
      }
      const piece = chess.get(sq);
      const pick = !!piece && piece.color === mine() && sq !== selected;
      if (pick) {
        selected = sq;
        // chess.js only lists moves for the side to move: during the machine's turn this is empty.
        targets = chess.moves({ square: sq, verbose: true });
        stage.board.lift(sq);
      } else deselect();
      marks();
      return pick || !!piece; // a piece is solid: clicking one never walks you into it
    },

    promote(type: PieceSymbol) {
      if (!promoting) return;
      const m = { ...promoting, promotion: type };
      promoting = null;
      attempt(m);
      publish();
    },

    cancelPromotion() {
      promoting = null;
      deselect();
      marks();
      publish();
    },

    hover(h: Hit) {
      const sq = resolve(h);
      const p = sq ? chess.get(sq) : undefined;
      const target = isTarget(sq);
      stage.board.hoverTile(target ? sq : null);
      stage.setCursor(live() && (target || p?.color === mine()));
      const next = p ? { ...LORE[p.type], side: SIDE[p.color] } : null;
      if (next?.name === hover?.name && next?.side === hover?.side) return;
      hover = next;
      publish();
    },

    /** Takes moves back the way they came: the stone walks back, the broken gathers itself, the floor mends. */
    async undo() {
      if (busy || phase === 'intro' || lesson) return;
      generation++;
      const g = generation;
      engine.stop();
      thinking = false;
      promoting = null;
      // Against the machine, take back your move and its answer.
      const plies = settings.mode === 'machine' ? (machineTurn() ? 1 : 2) : 1;
      for (let i = 0; i < plies; i++) chess.undo();
      phase = 'playing';
      deselect();
      busy = true;
      stage.board.highlight({});
      publish();
      await stage.board.rebuild(chess.board(), chess.history().length, 0.6);
      if (g !== generation) return;
      busy = false;
      marks();
      publish();
      if (settings.mode === 'friend') stage.face(chess.turn());
      if (machineTurn()) machine();
    },

    async toIntro() {
      lesson = null;
      generation++;
      engine.stop();
      thinking = false;
      promoting = null;
      phase = 'intro';
      deselect();
      stage.board.highlight({});
      publish();
      busy = true;
      await stage.toIntro();
      busy = false;
    },

    /** Set out a lesson's position and fly to it (or stay, if already over the board). */
    async lesson(l: Lesson) {
      const fly = phase !== 'lesson' && phase !== 'playing';
      generation++;
      engine.stop();
      engine.newGame();
      lesson = l;
      ls = { step: 0, moves: 0, mistakes: 0, hinted: false, ply: 0, solved: null, failed: false };
      feedback = null;
      chess.load(l.fen, { skipValidation: l.kind === 'clear' });
      deselect();
      promoting = null;
      thinking = false;
      phase = 'lesson';
      busy = true;
      stage.board.setBoard(chess.board(), 0);
      stage.board.highlight({});
      publish();
      if (fly) await stage.toGame('w');
      else await stage.face('w');
      busy = false;
      marks();
      publish();
    },

    /** Pick up the stone that should move (costs a cacao). */
    async hint() {
      const l = lesson;
      if (!l || !canMove()) return;
      let from: Square | undefined;
      if (l.kind === 'line') from = sim().move(l.line![ls.step].play[0]).from;
      else if (l.kind === 'goal') from = sim().moves({ verbose: true }).find(m => { const t = sim(); return GOALS[l.goal!](t.move(m), t); })?.from;
      else if (l.kind === 'clear') from = sim().moves({ verbose: true }).find(m => m.captured)?.from ?? sim().moves({ verbose: true })[0]?.from;
      else {
        const g = generation;
        thinking = true;
        publish();
        const uci = await engine.best(chess.fen(), 'hard');
        thinking = false;
        if (g !== generation) return;
        from = uci.slice(0, 2) as Square;
      }
      if (!from) return;
      ls.hinted = true;
      if (selected !== from) game.square(from);
      publish();
    },

    view: () => publish(),
  };
  return game;
}

export type Game = ReturnType<typeof createGame>;
