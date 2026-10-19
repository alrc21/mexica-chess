/**
 * The machine: Stockfish 19 lite (GPL-3.0, nmrugg/stockfish.js), single
 * threaded so it needs no cross-origin isolation, in a worker, spoken to in UCI.
 */
export type Level = 'easy' | 'medium' | 'hard';

const LEVELS: Record<Level, { skill: number; go: string }> = {
  easy: { skill: 0, go: 'go depth 3 movetime 300' },
  medium: { skill: 8, go: 'go movetime 700' },
  hard: { skill: 20, go: 'go movetime 1600' },
};

export type Engine = ReturnType<typeof createEngine>;

export function createEngine() {
  const worker = new Worker('/engine/stockfish-19-lite-single.js');
  let waiting: ((uci: string) => void) | null = null;
  let stale = 0; // stopped searches still owe a bestmove; it must not answer the next one
  worker.onmessage = e => {
    const line = String(e.data);
    if (!line.startsWith('bestmove')) return;
    if (stale) { stale--; return; }
    if (waiting) {
      const done = waiting;
      waiting = null;
      done(line.split(' ')[1]);
    }
  };
  worker.postMessage('uci');

  return {
    /** Best move for `fen` as UCI ("e2e4", "e7e8q"). */
    best(fen: string, level: Level): Promise<string> {
      const L = LEVELS[level];
      worker.postMessage(`setoption name Skill Level value ${L.skill}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(L.go);
      return new Promise(resolve => { waiting = resolve; });
    },
    stop() {
      if (!waiting) return;
      waiting = null;
      stale++;
      worker.postMessage('stop');
    },
    newGame() { worker.postMessage('ucinewgame'); worker.postMessage('isready'); },
    dispose() { worker.terminate(); },
  };
}
