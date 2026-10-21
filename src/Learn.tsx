import { useState, type CSSProperties } from 'react';
import { CHAPTERS, LESSONS, rankOf, type Lesson } from './lessons';
import { MAX_CACAO, totalCacao, type Progress } from './progress';

const EASE = 'cubic-bezier(.16,1,.3,1)';

/** A cacao bean — the Mexica's small change — filled once earned. */
export function Bean({ on, size = 9 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size * 1.45} viewBox="0 0 9 13" aria-hidden className="shrink-0">
      <ellipse cx="4.5" cy="6.5" rx="3.7" ry="5.7" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" opacity={on ? 1 : 0.45} />
      <path d="M4.5 1.4C3.3 4.4 5.7 8.6 4.5 11.6" fill="none" stroke={on ? 'var(--color-paper)' : 'currentColor'} strokeWidth="0.9" opacity={on ? 0.9 : 0.45} />
    </svg>
  );
}

export const Beans = ({ n, size }: { n: number; size?: number }) => (
  <span className="flex items-center gap-[3px]" aria-label={`${n} of 3 cacao`}>
    {[0, 1, 2].map(i => <Bean key={i} on={i < n} size={size} />)}
  </span>
);

/** The first lesson not yet solved: where to pick up. */
export const nextLesson = (p: Progress) => LESSONS.find(l => !p.cacao[l.id]) ?? null;

/**
 * Learn: the lessons, chapter by chapter, with the cacao each has earned, the
 * rank they add up to, and — under "What you know" — the rule each solved
 * lesson taught, written down. A glass sheet beside the board (from below on a phone).
 */
export default function Learn({ open, progress, current, onPick, onClose }: {
  open: boolean;
  progress: Progress;
  current: string | null;
  onPick: (l: Lesson) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'lessons' | 'known'>('lessons');
  const total = totalCacao(progress);
  const rank = rankOf(total);
  const next = nextLesson(progress);
  const known = LESSONS.filter(l => progress.cacao[l.id]);
  const sheet: CSSProperties = {
    transform: open ? 'none' : 'translate3d(0, 24px, 0)',
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    transition: `opacity 600ms ${EASE}, transform 700ms ${EASE}`,
  };

  return (
    <aside aria-hidden={!open} style={sheet}
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[84svh] flex-col rounded-t-[28px] border border-line bg-glass text-ink backdrop-blur-xl md:inset-y-4 md:left-auto md:right-4 md:max-h-none md:w-[420px] md:rounded-[28px]">
      <header className="px-6 pt-6 md:px-7 md:pt-7">
        <div className="flex items-start justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">Learn · your rank</p>
          <button type="button" onClick={onClose} className="-mt-1 text-[14px] transition-opacity duration-300 hover:opacity-60">Close</button>
        </div>
        <h2 className="mt-2 font-display text-[40px] font-light leading-none tracking-[-0.02em]">{rank.name}</h2>
        <p className="mt-2 text-[14px] text-soft">
          {rank.title} · {total} of {MAX_CACAO} cacao
          {rank.next && <> · {rank.next.at - total} to {rank.next.name}</>}
        </p>
        <div className="mt-4 h-px w-full bg-line">
          <div className="h-px bg-ink" style={{ width: `${(total / MAX_CACAO) * 100}%`, transition: `width 900ms ${EASE}` }} />
        </div>
        {progress.streak > 1 && <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-soft">{progress.streak} days running</p>}
        <nav className="mt-5 flex gap-5 text-[14px]">
          {(['lessons', 'known'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className="border-b pb-1 transition-[opacity,border-color] duration-300 hover:opacity-70"
              style={{ borderColor: tab === t ? 'currentColor' : 'transparent', opacity: tab === t ? 1 : 0.58 }}>
              {t === 'lessons' ? 'Lessons' : `What you know · ${known.length}`}
            </button>
          ))}
        </nav>
      </header>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-7">
        {tab === 'lessons' && CHAPTERS.map((c, ci) => (
          <section key={c.id} className="pt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">{String(ci + 1).padStart(2, '0')} · {c.title}</p>
            <p className="mt-1 text-[13px] text-soft">{c.line}</p>
            <ul className="mt-2">
              {LESSONS.filter(l => l.chapter === c.id).map(l => {
                const earned = progress.cacao[l.id] ?? 0;
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => onPick(l)}
                      className="group flex w-full items-center gap-3 border-b border-line py-3 text-left transition-opacity duration-300 hover:opacity-70">
                      <span className="min-w-0 flex-1 truncate text-[15px]">{l.title}</span>
                      {l.id === current && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-soft">Now</span>}
                      {l.id !== current && l === next && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-soft">Next</span>}
                      <Beans n={earned} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {tab === 'known' && (known.length ? (
          <ul className="pt-3">
            {known.map(l => (
              <li key={l.id} className="border-b border-line py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-soft">{l.title}</p>
                <p className="mt-1 text-[14px] leading-[1.45]">{l.learned}</p>
              </li>
            ))}
          </ul>
        ) : <p className="pt-6 text-[14px] leading-[1.5] text-soft">Solve a lesson and the rule it teaches is written down here, in your own codex.</p>)}
      </div>
    </aside>
  );
}
