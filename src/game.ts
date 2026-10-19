import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { wait } from './anim';
import type { Engine, Level } from './engine';
import { LORE, SIDE } from './lore';
import type { Stage } from './stage';

export type Settings = { side: Color; mode: 'machine' | 'friend'; level: Level };

export type View = {
  phase: 'intro' | 'playing' | 'over';
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
};

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
  let generation = 0; // bumps on undo/new game so a late engine reply is ignored

  const machineTurn = () => settings.mode === 'machine' && chess.turn() !== settings.side;

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
    canUndo: phase !== 'intro' && !busy && chess.history().length > (settings.mode === 'machine' && settings.side === 'b' ? 1 : 0),
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
      check: chess.inCheck() ? kingSquare(chess.turn()) : null,
    });
  }

  function deselect() {
    selected = null;
    targets = [];
    stage.board.lift(null);
  }

  async function apply(m: { from: string; to: string; promotion?: string }) {
    busy = true;
    selected = null;
    targets = [];
    const move = chess.move(m);
    stage.board.highlight({});
    publish();
    await stage.board.play(move);
    busy = false;
    marks();
    if (chess.isGameOver()) phase = 'over';
    publish();
    if (phase === 'playing' && machineTurn()) machine();
  }

  async function machine() {
    thinking = true;
    publish();
    const g = generation;
    const [uci] = await Promise.all([engine.best(chess.fen(), settings.level), wait(500)]);
    if (g !== generation || phase !== 'playing') return;
    thinking = false;
    await apply({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }

  return {
    async start(s: Settings) {
      settings = s;
      generation++;
      engine.stop();
      engine.newGame();
      chess.reset();
      deselect();
      promoting = null;
      thinking = false;
      phase = 'playing';
      busy = true;
      stage.board.setBoard(chess.board());
      stage.board.highlight({});
      publish();
      await stage.toGame(s.side);
      busy = false;
      marks();
      publish();
      if (machineTurn()) machine();
    },

    square(sq: Square) {
      if (phase !== 'playing' || busy || thinking || promoting || machineTurn()) return;
      const options = targets.filter(m => m.to === sq);
      if (selected && options.length) {
        if (options.some(m => m.promotion)) {
          promoting = { from: selected, to: sq };
          publish();
          return;
        }
        apply({ from: selected, to: sq });
        return;
      }
      const piece = chess.get(sq);
      if (piece && piece.color === chess.turn() && sq !== selected) {
        selected = sq;
        targets = chess.moves({ square: sq, verbose: true });
        stage.board.lift(sq);
      } else deselect();
      marks();
    },

    promote(type: PieceSymbol) {
      if (!promoting) return;
      const m = { ...promoting, promotion: type };
      promoting = null;
      apply(m);
    },

    cancelPromotion() {
      promoting = null;
      deselect();
      marks();
      publish();
    },

    hover(sq: Square | null) {
      const p = sq ? chess.get(sq) : undefined;
      const next = p ? { ...LORE[p.type], side: SIDE[p.color] } : null;
      if (next?.name === hover?.name && next?.side === hover?.side) return;
      hover = next;
      const mine = p && p.color === chess.turn() && !machineTurn();
      stage.setCursor(phase === 'playing' && (!!mine || targets.some(m => m.to === sq)));
      publish();
    },

    undo() {
      if (busy || phase === 'intro') return;
      generation++;
      engine.stop();
      thinking = false;
      promoting = null;
      // Against the machine, take back your move and its answer.
      const plies = settings.mode === 'machine' ? (machineTurn() ? 1 : 2) : 1;
      for (let i = 0; i < plies; i++) chess.undo();
      phase = 'playing';
      deselect();
      stage.board.setBoard(chess.board());
      marks();
      publish();
      if (machineTurn()) machine();
    },

    async toIntro() {
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

    view: () => publish(),
  };
}

export type Game = ReturnType<typeof createGame>;
