/**
 * Learning to play, on the real board: each lesson is a position and a task.
 * Every position and answer here is checked by `node scripts/lessons.mjs`
 * (legal, solvable, the par is the true minimum, the tactic is the engine's
 * choice, the mates are mates) — wrong chess in a teaching mode is the one
 * unforgivable bug.
 *
 * Kinds:
 *  clear — take every Basalt stone; they never move. `par` is the fewest moves.
 *  goal  — make any move that does `goal` (check, castle, promote, en passant, mate).
 *  line  — play the accepted move at each step; the other side answers with `reply`.
 *  hunt  — mate the machine (playing its best) within `within` of your moves.
 */
export type Goal = 'check' | 'castle' | 'promote' | 'enpassant' | 'mate';
export type Step = { play: string[]; reply?: string };
export type Chapter = 'pieces' | 'rules' | 'tactics' | 'mates' | 'strategy';
export type Lesson = {
  id: string;
  chapter: Chapter;
  title: string;
  brief: string;
  /** What you know once it's done: written into your codex. */
  learned: string;
  fen: string;
  kind: 'clear' | 'goal' | 'line' | 'hunt';
  par?: number;
  goal?: Goal;
  line?: Step[];
  within?: number;
  /** Said when a move is legal but not the lesson's answer. */
  wrong?: string;
};

export const CHAPTERS: { id: Chapter; title: string; line: string }[] = [
  { id: 'pieces', title: 'The stones', line: 'How each one moves.' },
  { id: 'rules', title: 'The rules', line: 'Check, mate and the special moves.' },
  { id: 'tactics', title: 'Tactics', line: 'One move that wins a stone.' },
  { id: 'mates', title: 'Mates', line: 'How a game is won.' },
  { id: 'strategy', title: 'Strategy', line: 'How to begin, how to finish.' },
];

export const LESSONS: Lesson[] = [
  // ── The stones: drills against stones that never move ─────────────────────
  {
    id: 'teocalli', chapter: 'pieces', title: 'The Teocalli', kind: 'clear', par: 3,
    fen: '8/8/p4p2/8/8/8/5p2/R7 w - - 0 1',
    brief: 'The Teocalli, the rook, moves in straight lines, as far as the way is clear. Take all three Basalt stones.',
    learned: 'Teocalli (rook): straight lines, any distance, never through a stone.',
  },
  {
    id: 'cuauhtli', chapter: 'pieces', title: 'The Cuauhtli', kind: 'clear', par: 3,
    fen: '8/8/3p4/8/1p3p2/8/8/2B5 w - - 0 1',
    brief: 'The Cuauhtli, the eagle — the bishop — flies on the diagonals and never leaves its colour. Take all three.',
    learned: 'Cuauhtli (bishop): diagonals, any distance; it stays on one colour all game.',
  },
  {
    id: 'cihuacoatl', chapter: 'pieces', title: 'The Cihuacoatl', kind: 'clear', par: 3,
    fen: '8/3p4/8/8/p6p/8/8/3Q4 w - - 0 1',
    brief: 'The Cihuacoatl, the queen, moves like the Teocalli and the Cuauhtli together: the strongest stone. Take all three.',
    learned: 'Cihuacoatl (queen): straight lines and diagonals, any distance.',
  },
  {
    id: 'ocelotl', chapter: 'pieces', title: 'The Ocelotl', kind: 'clear', par: 3,
    fen: '8/8/5p2/8/4p3/2p5/8/1N6 w - - 0 1',
    brief: 'The Ocelotl, the jaguar — the knight — leaps in an L: two squares one way, one to the side. It jumps over anything. Take all three.',
    learned: 'Ocelotl (knight): an L-shaped leap, over any stone in the way.',
  },
  {
    id: 'tlatoani', chapter: 'pieces', title: 'The Huey Tlatoani', kind: 'clear', par: 4,
    fen: '8/8/8/8/8/3p1p2/8/4K3 w - - 0 1',
    brief: 'The Tlatoani, the king, steps one square any way — but never onto a square an enemy attacks. A Macehualli attacks the two squares diagonally ahead of it. Take both.',
    learned: 'Huey Tlatoani (king): one square any way, never into attack.',
  },
  {
    id: 'macehualli', chapter: 'pieces', title: 'The Macehualli', kind: 'clear', par: 4,
    fen: '8/8/2p5/8/3p4/8/4P3/8 w - - 0 1',
    brief: 'The Macehualli, the foot soldier — the pawn — marches straight ahead, one square (two on its first step), and takes on the diagonal. Take both.',
    learned: 'Macehualli (pawn): forward one (two from the start), takes diagonally forward.',
  },

  // ── The rules ───────────────────────────────────────────────────────────
  {
    id: 'check', chapter: 'rules', title: 'Check', kind: 'goal', goal: 'check',
    fen: '4k3/5pp1/8/8/8/8/8/3Q2K1 w - - 0 1',
    brief: 'A stone that attacks the Tlatoani gives check. Give check with the Cihuacoatl.',
    learned: 'Check: the Tlatoani is attacked, and must be saved at once.',
    wrong: 'That doesn’t attack the Tlatoani. Look for a line that reaches him.',
  },
  {
    id: 'escape', chapter: 'rules', title: 'Out of check', kind: 'line',
    fen: '4k3/8/8/8/4r3/8/2B5/4K3 w - - 0 1',
    line: [{ play: ['Bxe4'] }],
    brief: 'You are in check. There are three ways out: step away, block, or take the attacker. Here, take it.',
    learned: 'Out of check: move the Tlatoani, block the line, or take the attacker.',
    wrong: 'That escapes — but taking the attacker wins a Teocalli.',
  },
  {
    id: 'castle', chapter: 'rules', title: 'Castling', kind: 'goal', goal: 'castle',
    fen: '4k3/8/8/8/8/8/PPP2PPP/R3K2R w KQ - 0 1',
    brief: 'Once a game the Tlatoani can take shelter: he steps two squares toward a Teocalli, and it jumps over him. Pick him up and castle.',
    learned: 'Castling: once a game, if neither has moved and no square he crosses is attacked.',
    wrong: 'Pick up the Tlatoani and move him two squares toward a Teocalli.',
  },
  {
    id: 'promote', chapter: 'rules', title: 'Crowning', kind: 'goal', goal: 'promote',
    fen: '7k/1P6/8/8/8/8/8/6K1 w - - 0 1',
    brief: 'A Macehualli that reaches the far side is crowned: it becomes any stone but the Tlatoani. March it in.',
    learned: 'Promotion: a pawn on the last rank becomes a queen, rook, bishop or knight.',
    wrong: 'The Macehualli on b7 is one step from the far side.',
  },
  {
    id: 'enpassant', chapter: 'rules', title: 'In passing', kind: 'goal', goal: 'enpassant',
    fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
    brief: 'Basalt just marched two squares, past your Macehualli. Right now — and only now — you may take it as if it had stepped one.',
    learned: 'En passant: a pawn that steps two past yours can be taken as if it stepped one — on the very next move.',
    wrong: 'Take the Basalt Macehualli diagonally, landing behind it on d6.',
  },
  {
    id: 'mate', chapter: 'rules', title: 'Checkmate', kind: 'goal', goal: 'mate',
    fen: 'k7/8/1K6/8/8/8/7Q/8 w - - 0 1',
    brief: 'Check with no way out is checkmate, and the game is won. Your Tlatoani guards the squares near his. Mate in one.',
    learned: 'Checkmate: check with no escape, no block, no capture. The game is over.',
    wrong: 'Close to it. Give check so that every square around him is covered.',
  },
  {
    id: 'stalemate', chapter: 'rules', title: 'Not a stalemate', kind: 'goal', goal: 'mate',
    fen: 'k7/2K5/8/1Q6/8/8/8/8 w - - 0 1',
    brief: 'Mate in one. Careful: if he has no legal move and is not in check, it’s stalemate — a draw.',
    learned: 'Stalemate: no legal move and not in check is a draw. Always leave a square, or give check.',
    wrong: 'Not mate yet. Find the check he can’t escape.',
  },

  // ── Tactics ─────────────────────────────────────────────────────────────
  {
    id: 'fork', chapter: 'tactics', title: 'The fork', kind: 'line',
    fen: 'r3k3/8/8/1N6/8/8/8/6K1 w - - 0 1',
    line: [{ play: ['Nc7+'], reply: 'Ke7' }, { play: ['Nxa8'] }],
    brief: 'One stone, two targets. Find the leap that attacks the Tlatoani and the Teocalli at once.',
    learned: 'Fork: one stone attacks two. The Ocelotl is the best at it.',
    wrong: 'Look for a square where the Ocelotl attacks both the Tlatoani and the Teocalli.',
  },
  {
    id: 'pin', chapter: 'tactics', title: 'The pin', kind: 'line',
    fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1',
    line: [{ play: ['Bb5'] }],
    brief: 'Pin the Ocelotl: attack it along a line that runs on to the Tlatoani. It can’t move without exposing him.',
    learned: 'Pin: attack a stone that shields its Tlatoani. It can no longer move.',
    wrong: 'Put the Cuauhtli on the diagonal that runs through the Ocelotl to the Tlatoani.',
  },
  {
    id: 'skewer', chapter: 'tactics', title: 'The skewer', kind: 'line',
    fen: '4q3/8/8/8/4k3/8/8/R6K w - - 0 1',
    line: [{ play: ['Re1+'], reply: 'Kf5' }, { play: ['Rxe8'] }],
    brief: 'Check the Tlatoani along the line he shares with the Cihuacoatl. When he steps aside, take her.',
    learned: 'Skewer: attack the big stone; when it moves, take the one behind it.',
    wrong: 'The Tlatoani and the Cihuacoatl share a file. Check along it.',
  },
  {
    id: 'discovery', chapter: 'tactics', title: 'The discovery', kind: 'line',
    fen: '4k3/8/8/2q5/4N3/8/8/4R2K w - - 0 1',
    line: [{ play: ['Nxc5+'] }],
    brief: 'Move the stone in front and the one behind it strikes. The Ocelotl can step aside with check from the Teocalli — and take something on the way.',
    learned: 'Discovered attack: moving one stone uncovers another’s attack. Two threats in one move.',
    wrong: 'Step the Ocelotl off the file so the Teocalli gives check — onto the square that wins the most.',
  },
  {
    id: 'values', chapter: 'tactics', title: 'Counting stones', kind: 'line',
    fen: '6k1/8/4p3/1r1n4/8/8/8/3Q1BK1 w - - 0 1',
    line: [{ play: ['Bxb5'] }],
    brief: 'Macehualli 1, Ocelotl 3, Cuauhtli 3, Teocalli 5, Cihuacoatl 9. Two captures are open. Take the one that wins.',
    learned: 'Value: pawn 1 · knight 3 · bishop 3 · rook 5 · queen 9. A guarded stone costs you the taker.',
    wrong: 'The Ocelotl on d5 is guarded: your Cihuacoatl (9) for an Ocelotl (3) is a bad trade.',
  },

  // ── Mates ───────────────────────────────────────────────────────────────
  {
    id: 'backrank', chapter: 'mates', title: 'The back rank', kind: 'goal', goal: 'mate',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    brief: 'His own Macehualli wall him in. Mate in one.',
    learned: 'Back-rank mate: a Tlatoani behind his own pawns has no air. Give yours a square.',
    wrong: 'He can’t step forward through his own stones. Check him along the back rank.',
  },
  {
    id: 'smothered', chapter: 'mates', title: 'Smothered', kind: 'goal', goal: 'mate',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    brief: 'The Tlatoani is boxed in by his own stones. Only one stone can reach him over them. Mate in one.',
    learned: 'Smothered mate: an Ocelotl mates a Tlatoani walled in by his own stones.',
    wrong: 'Only the Ocelotl can jump over his wall. Where does it attack the corner from?',
  },
  {
    id: 'ladder', chapter: 'mates', title: 'The ladder', kind: 'hunt', within: 11,
    fen: '8/8/8/8/4k3/8/R7/1R4K1 w - - 0 1',
    brief: 'Two Teocalli climb like a ladder: one holds a rank, the other checks on the next. Drive the Tlatoani to the edge and mate him. He defends his best.',
    learned: 'Ladder mate: two rooks, rank by rank, push the king to the edge.',
  },
  {
    id: 'queenmate', chapter: 'mates', title: 'Cihuacoatl and Tlatoani', kind: 'hunt', within: 14,
    fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
    brief: 'The Cihuacoatl alone can’t mate: she herds him to the edge, your Tlatoani comes up, and together they finish it. Don’t stalemate him.',
    learned: 'Queen and king mate: herd him to the edge, bring your king, mate together.',
  },

  // ── Strategy ────────────────────────────────────────────────────────────
  {
    id: 'centre', chapter: 'strategy', title: 'The centre', kind: 'line',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    line: [{ play: ['e4', 'd4'] }],
    brief: 'The four squares in the middle are the high ground. Open by claiming them with a Macehualli.',
    learned: 'Open with a centre pawn: it frees your stones and claims the middle.',
    wrong: 'Playable — but a pawn in the very centre claims more ground.',
  },
  {
    id: 'develop', chapter: 'strategy', title: 'Bring them out', kind: 'line',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    line: [{ play: ['Nf3', 'Nc3'] }],
    brief: 'Stones at home don’t fight. Bring an Ocelotl out toward the centre.',
    learned: 'Develop: knights and bishops out early, toward the centre, each moved once.',
    wrong: 'Bring out an Ocelotl, toward the middle of the board.',
  },
  {
    id: 'shelter', chapter: 'strategy', title: 'Shelter early', kind: 'line',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    line: [{ play: ['O-O'] }],
    brief: 'Your stones are out and the way is clear. Put the Tlatoani in safety before the fighting starts.',
    learned: 'Castle early: the Tlatoani safe in a corner, a Teocalli brought toward the centre.',
    wrong: 'The way between the Tlatoani and the Teocalli is clear. Castle.',
  },
  {
    id: 'race', chapter: 'strategy', title: 'The race', kind: 'line',
    fen: '8/8/8/1P3k2/8/8/8/7K w - - 0 1',
    line: [{ play: ['b6'], reply: 'Ke6' }, { play: ['b7'], reply: 'Kd7' }, { play: ['b8=Q'] }],
    brief: 'Draw a square from your Macehualli to the far side. A Tlatoani outside it can’t catch the pawn. March, and crown it as the Cihuacoatl.',
    learned: 'The square of the pawn: if the king stands outside it, the pawn queens alone.',
    wrong: 'March the Macehualli — and crown it as the Cihuacoatl.',
  },
];

/** Cacao beans earned: three for a clean solve; mistakes, a hint or extra moves cost one each, down to one. */
export const cacaoFor = (mistakes: number, hinted: boolean, over: number) =>
  3 - Math.min(2, mistakes + (hinted ? 1 : 0) + (over > 0 ? 1 : 0));

/**
 * Rank rises with cacao, through the stones of the board: a Mexica warrior
 * rose by the captives he took.
 */
export const RANKS = [
  { at: 0, name: 'Macehualli', title: 'foot soldier' },
  { at: 12, name: 'Tlamani', title: 'captor' },
  { at: 30, name: 'Ocelotl', title: 'jaguar warrior' },
  { at: 50, name: 'Cuauhtli', title: 'eagle warrior' },
  { at: 75, name: 'Tlatoani', title: 'the one who speaks' },
];

export function rankOf(cacao: number) {
  let i = 0;
  while (i + 1 < RANKS.length && cacao >= RANKS[i + 1].at) i++;
  return { ...RANKS[i], next: RANKS[i + 1] ?? null };
}
