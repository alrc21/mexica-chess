import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PieceSymbol } from 'chess.js';
import { createEngine, type Level } from './engine';
import { createGame, type Game, type Settings, type View } from './game';
import { LORE } from './lore';
import Segmented from './Segmented';
import { createStage } from './stage';

const EASE = 'cubic-bezier(.16,1,.3,1)';
const SIDES = ['w', 'b'] as const;
const MODES = ['machine', 'friend'] as const;
const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const CROWNS: PieceSymbol[] = ['q', 'r', 'b', 'n'];

const fade = (on: boolean, ms = 900): CSSProperties => ({
  opacity: on ? 1 : 0,
  transform: on ? 'none' : 'translateY(10px)',
  transition: `opacity ${ms}ms ${EASE}, transform ${ms}ms ${EASE}`,
  pointerEvents: on ? 'auto' : 'none',
});

/**
 * The stone owns the screen; the interface sits in the corners as plain type
 * and gets out of the way — the same chrome as Curated Motions.
 */
export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [settings, setSettings] = useState<Settings>({ side: 'w', mode: 'machine', level: 'medium' });

  useEffect(() => {
    const engine = createEngine();
    const dispose = createStage(canvas.current!, {
      onReady: stage => {
        game.current = createGame(stage, engine, setView);
        game.current.view();
        if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game.current;
      },
      onSquare: sq => game.current?.square(sq),
      onHover: sq => game.current?.hover(sq),
    });
    return () => { dispose(); engine.dispose(); };
  }, []);

  const g = game.current;
  const intro = view?.phase === 'intro';
  const playing = view?.phase === 'playing' || view?.phase === 'over';
  const over = view?.phase === 'over';

  return (
    <>
      <canvas ref={canvas} className="fixed inset-0 h-full w-full touch-none outline-none" />

      {/* Contrast: a vignette and a veil under the type, both in the page colour. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-10"
        style={{ background: 'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgba(5,4,3,0.6) 100%)' }} />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[38svh]"
        style={{ background: 'linear-gradient(to top, rgba(11,10,8,0.85), rgba(11,10,8,0))' }} />

      <div aria-hidden className="pointer-events-none fixed inset-0 z-10" style={{
        background: 'radial-gradient(ellipse 60% 75% at 0% 100%, rgba(11,10,8,0.82), rgba(11,10,8,0) 70%)',
        opacity: intro ? 1 : 0, transition: `opacity 1200ms ${EASE}`,
      }} />

      {/* Curtain: lifts once the stone has loaded and compiled. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-50 bg-paper"
        style={{ opacity: view ? 0 : 1, transition: `opacity 1600ms ${EASE}` }} />

      <div className="pointer-events-none fixed inset-0 z-40 text-ink">
        {/* ── Intro ─────────────────────────────────────────────────────── */}
        <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8">
          <button type="button" onClick={() => g?.toIntro()} style={fade(!!playing)}
            className="font-display text-[17px] tracking-[-0.01em] transition-opacity duration-300 hover:opacity-60">
            Mexica Chess
          </button>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft" style={fade(intro)}>
            Templo Mayor, Tenochtitlan
          </span>
          <nav className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] flex gap-5 text-[14px] md:right-8 md:gap-7" style={fade(!!playing)}>
            <button type="button" onClick={() => g?.undo()} disabled={!view?.canUndo}
              className="transition-opacity duration-300 hover:opacity-60 disabled:opacity-30">Undo</button>
            <button type="button" onClick={() => g?.toIntro()} className="transition-opacity duration-300 hover:opacity-60">New game</button>
          </nav>
        </header>

        <section className="absolute bottom-0 left-0 w-full max-w-[640px] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pb-10" style={fade(intro, 1200)}>
          <h1 className="font-display text-[52px] font-light leading-[0.95] tracking-[-0.03em] md:text-[92px]"
            style={{ textShadow: '0 2px 40px rgba(11,10,8,0.85)' }}>Mexica Chess</h1>
          <p className="mt-4 max-w-[36ch] text-[16px] leading-[1.5] text-soft md:text-[17px]">
            Chess carved in volcanic stone. Red tezontle against black basalt, on the plaza of Tenochtitlan at night.
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            <Segmented label="You play" labelWidth="5.5rem" options={['Tezontle', 'Basalt']}
              index={SIDES.indexOf(settings.side)} onSelect={i => setSettings(s => ({ ...s, side: SIDES[i] }))} />
            <Segmented label="Against" labelWidth="5.5rem" options={['The machine', 'A friend']}
              index={MODES.indexOf(settings.mode)} onSelect={i => setSettings(s => ({ ...s, mode: MODES[i] }))} />
            <div style={{ opacity: settings.mode === 'machine' ? 1 : 0.3, transition: `opacity 400ms ${EASE}` }}>
              <Segmented label="Level" labelWidth="5.5rem" options={['Easy', 'Medium', 'Hard']}
                index={LEVELS.indexOf(settings.level)} onSelect={i => setSettings(s => ({ ...s, level: LEVELS[i] }))} />
            </div>
          </div>
          <button type="button" onClick={() => g?.start(settings)}
            className="pointer-events-auto mt-8 rounded-full bg-ink px-7 py-3 text-[15px] text-paper transition-[opacity,transform] duration-300 hover:opacity-85 active:scale-[0.98]">
            Play
          </button>
        </section>

        {/* ── Game ──────────────────────────────────────────────────────── */}
        <footer className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-8" style={fade(!!playing && !over)}>
          <div className="min-w-0">
            <p className="flex items-center gap-3 font-display text-[30px] font-light leading-none tracking-[-0.02em] md:text-[44px]">
              {view?.status}
              {view?.thinking && <span aria-hidden className="mc-breathe inline-block h-2 w-2 rounded-full bg-ink" />}
            </p>
            <p className="mt-3 h-4 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-soft">
              {view?.hover ? `${view.hover.name} · ${view.hover.role} · ${view.hover.side}` : ''}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[12px] tracking-[0.04em] text-soft">{view?.last ?? ''}</span>
        </footer>

        {/* Promotion: the pawn reached the far rank. */}
        <div className="absolute inset-0 flex items-center justify-center px-5" style={fade(!!view?.promoting, 500)}>
          <div className="rounded-[28px] border border-[rgba(236,230,218,0.16)] bg-[rgba(11,10,8,0.72)] p-6 backdrop-blur-xl md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">Your pawn reached the far side</p>
            <p className="mt-2 font-display text-[28px] font-light tracking-[-0.02em]">It becomes</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {CROWNS.map(k => (
                <button key={k} type="button" onClick={() => g?.promote(k)}
                  className="rounded-2xl border border-[rgba(236,230,218,0.18)] px-4 py-3 text-left transition-colors duration-300 hover:bg-[rgba(236,230,218,0.08)]">
                  <span className="block text-[15px]">{LORE[k].name}</span>
                  <span className="block text-[12px] text-soft">{LORE[k].role.split(' · ')[0]}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => g?.cancelPromotion()} className="mt-4 text-[13px] text-soft transition-opacity hover:opacity-60">Cancel</button>
          </div>
        </div>

        {/* Game over. */}
        <div className="absolute inset-x-0 bottom-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pb-10" style={fade(over, 1200)}>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">{view?.result?.detail}</p>
          <h2 className="mt-3 font-display text-[52px] font-light leading-[0.95] tracking-[-0.03em] md:text-[88px]">{view?.result?.title}</h2>
          <div className="mt-7 flex items-center gap-6">
            <button type="button" onClick={() => g?.start(view!.settings)}
              className="rounded-full bg-ink px-7 py-3 text-[15px] text-paper transition-opacity duration-300 hover:opacity-85">Play again</button>
            <button type="button" onClick={() => g?.undo()} className="text-[14px] transition-opacity hover:opacity-60">Take back</button>
            <button type="button" onClick={() => g?.toIntro()} className="text-[14px] transition-opacity hover:opacity-60">Change sides</button>
          </div>
        </div>
      </div>
    </>
  );
}
