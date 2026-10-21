import { LESSONS } from './lessons';

/**
 * What you've learned, kept in this browser only: the best cacao per lesson
 * and the days in a row you came back to practise. Versioned, and every read
 * and write guarded — private windows and blocked storage just forget.
 */
export type Progress = { v: 1; cacao: Record<string, number>; streak: number; last: string };

const KEY = 'mc-learn-v1';
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const fresh = (): Progress => ({ v: 1, cacao: {}, streak: 0, last: '' });

export function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Progress | null;
    if (p?.v !== 1 || typeof p.cacao !== 'object') return fresh();
    // A streak missed by more than a day is over.
    const gap = p.last ? (Date.parse(today()) - Date.parse(p.last)) / 864e5 : 0;
    return gap > 1 ? { ...p, streak: 0 } : p;
  } catch { return fresh(); }
}

/** Records a solve (keeps the best cacao) and counts today toward the streak. */
export function recordSolve(p: Progress, id: string, cacao: number): Progress {
  const d = today();
  const gap = p.last ? (Date.parse(d) - Date.parse(p.last)) / 864e5 : Infinity;
  const next: Progress = {
    v: 1,
    cacao: { ...p.cacao, [id]: Math.max(cacao, p.cacao[id] ?? 0) },
    streak: gap === 0 ? Math.max(1, p.streak) : gap === 1 ? p.streak + 1 : 1,
    last: d,
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not kept: still counted this visit */ }
  return next;
}

export const totalCacao = (p: Progress) => LESSONS.reduce((n, l) => n + (p.cacao[l.id] ?? 0), 0);
export const MAX_CACAO = LESSONS.length * 3;
