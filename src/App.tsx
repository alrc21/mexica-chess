import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PieceSymbol } from 'chess.js';
import { createEngine, type Level } from './engine';
import { createGame, type Game, type Settings, type View } from './game';
import Learn, { Beans } from './Learn';
import { CHAPTERS, LESSONS, type Lesson } from './lessons';
import { CARVING, LORE, SIDE, type Carving } from './lore';
import { loadProgress, recordSolve } from './progress';
import Segmented from './Segmented';
import { createStage, FIRST_CARVING, type Stage } from './stage';
import type { Place } from './atmosphere';

const EASE = 'cubic-bezier(.16,1,.3,1)';
const SIDES = ['w', 'b'] as const;
const MODES = ['machine', 'friend'] as const;
const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const CROWNS: PieceSymbol[] = ['q', 'r', 'b', 'n'];
const PLACES: Place[] = ['tenochtitlan', 'calakmul'];
const CARVINGS = Object.keys(CARVING) as Carving[];
Object.assign(SIDE, CARVING[FIRST_CARVING].sides); // ?stone= starts in a mineral
const WHERE: Record<Place, { label: string; line: string }> = {
  tenochtitlan: { label: 'Templo Mayor, Tenochtitlan', line: 'on the plaza of Tenochtitlan.' },
  calakmul: { label: 'Calakmul, Campeche', line: 'on a temple above the forest of Calakmul.' },
};
const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const fade = (on: boolean, ms = 900): CSSProperties => ({
  opacity: on ? 1 : 0,
  transform: on ? 'none' : 'translateY(10px)',
  transition: `opacity ${ms}ms ${EASE}, transform ${ms}ms ${EASE}`,
  pointerEvents: on ? 'auto' : 'none',
});

/**
 * The stone owns the screen; the interface sits in the corners as plain type
 * and gets out of the way — the same chrome as Curated Motions. By day the
 * type turns to ink on a pale veil, by night cream on a dark one.
 */
export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const stage = useRef<Stage | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [settings, setSettings] = useState<Settings>({ side: 'w', mode: 'machine', level: 'medium' });
  const [day, setDay] = useState(false);
  const [walking, setWalking] = useState(false);
  const [moving, setMoving] = useState(false); // a camera change is under way
  const [muted, setMuted] = useState(false);
  const [hint, setHint] = useState(false);
  const [place, setPlace] = useState<Place>('tenochtitlan');
  const [carving, setCarving] = useState<Carving>(FIRST_CARVING);
  const [veiled, setVeiled] = useState(false); // a short curtain while the place or the stone changes
  const [learning, setLearning] = useState(false); // the lessons sheet is open
  const [progress, setProgress] = useState(loadProgress);

  useEffect(() => {
    const engine = createEngine();
    const dispose = createStage(canvas.current!, {
      onReady: s => {
        stage.current = s;
        setMuted(s.audio.muted);
        game.current = createGame(s, engine, setView);
        game.current.view();
        if (import.meta.env.DEV) Object.assign(window, { __game: game.current, __stage: s });
      },
      onSquare: hit => game.current?.click(hit) ?? false,
      onHover: hit => game.current?.hover(hit),
      onGrab: hit => game.current?.grab(hit) ?? null,
      onDrop: hit => game.current?.drop(hit) ?? false,
    });
    return () => { dispose(); engine.dispose(); };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = day ? 'day' : 'night'; }, [day]);
  // A solved lesson is written into this browser's progress (the best cacao is kept).
  const solvedId = view?.lesson?.solved != null ? view.lesson.id : null;
  const solvedCacao = view?.lesson?.solved ?? null;
  useEffect(() => {
    if (solvedId && solvedCacao !== null) setProgress(p => recordSolve(p, solvedId, solvedCacao));
  }, [solvedId, solvedCacao]);

  const g = game.current;
  const intro = view?.phase === 'intro';
  const playing = view?.phase === 'playing' || view?.phase === 'over';
  const over = view?.phase === 'over';
  const inLesson = view?.phase === 'lesson';
  const lesson = inLesson ? LESSONS.find(l => l.id === view?.lesson?.id) ?? null : null;
  const lessonIndex = lesson ? LESSONS.indexOf(lesson) : -1;
  const following = lessonIndex >= 0 ? LESSONS[lessonIndex + 1] ?? null : null;
  const ls = view?.lesson;
  const tone = day ? 'light' : 'dark';
  const veil = day ? '236,230,218' : '11,10,8';

  const changeHour = async (on: boolean) => {
    if (on === day || moving) return;
    setDay(on);
    setMoving(true);
    await stage.current?.setDay(on);
    setMoving(false);
  };
  const changeWalk = async (on: boolean) => {
    if (on === walking || moving) return;
    setWalking(on);
    setMoving(true);
    await stage.current?.setWalking(on);
    setMoving(false);
    setHint(on);
    if (on) setTimeout(() => setHint(false), 7000);
  };
  // The place swaps behind a brief curtain: you close your eyes in one city and open them in the other.
  const changePlace = (p: Place) => {
    if (p === place || veiled) return;
    setPlace(p);
    setVeiled(true);
    setTimeout(() => { stage.current?.setPlace(p); setTimeout(() => setVeiled(false), 120); }, 650);
  };
  // So does the stone; the curtain waits for the new one's shaders. The armies take its names.
  const changeCarving = (c: Carving) => {
    if (c === carving || veiled || !stage.current) return;
    setCarving(c);
    Object.assign(SIDE, CARVING[c].sides);
    setVeiled(true);
    setTimeout(async () => { await stage.current?.setStone(c); setTimeout(() => setVeiled(false), 120); }, 650);
  };
  const leave = () => { setWalking(false); setHint(false); setLearning(false); g?.toIntro(); };
  const study = (l: Lesson) => { setLearning(false); setWalking(false); setHint(false); g?.lesson(l); };
  const again = () => { setWalking(false); setHint(false); g?.start(view!.settings); };
  const mute = () => {
    stage.current?.audio.setMuted(!muted);
    setMuted(!muted);
  };

  return (
    <>
      <canvas ref={canvas} className="fixed inset-0 h-full w-full touch-none outline-none" />

      {/* Contrast: a vignette and veils under the type, in the page colour of the hour. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-10" style={{
        background: `radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgba(${day ? '24,20,14' : '5,4,3'},${day ? 0.28 : 0.6}) 100%)`,
      }} />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[38svh]"
        style={{ background: `linear-gradient(to top, rgba(${veil},${day ? 0.5 : 0.85}), rgba(${veil},0) ${day ? '60%' : '100%'})` }} />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-10 h-[11svh]"
        style={{ background: `linear-gradient(to bottom, rgba(${veil},${day ? 0.3 : 0.35}), rgba(${veil},0))` }} />

      <div aria-hidden className="pointer-events-none fixed inset-0 z-10" style={{
        background: `radial-gradient(ellipse 60% 75% at 0% 100%, rgba(${veil},${day ? 0.75 : 0.82}), rgba(${veil},0) 70%)`,
        opacity: intro ? 1 : 0, transition: `opacity 1200ms ${EASE}`,
      }} />

      {/* Curtain: lifts once the stone has loaded and compiled. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-50 bg-[#0b0a08]"
        style={{ opacity: view && !veiled ? 0 : 1, transition: `opacity ${veiled ? 600 : 1600}ms ${EASE}` }} />

      <div className="pointer-events-none fixed inset-0 z-40 text-ink">
        <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8">
          <button type="button" onClick={leave} style={fade(!!playing || inLesson)}
            className="font-display text-[17px] tracking-[-0.01em] transition-opacity duration-300 hover:opacity-60">
            Mexica Chess
          </button>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft" style={fade(intro)}>
            {WHERE[place].label}
          </span>
          <nav className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] flex gap-5 text-[14px] md:right-8 md:gap-7" style={fade(!!playing)}>
            <button type="button" onClick={() => g?.undo()} disabled={!view?.canUndo}
              className="transition-opacity duration-300 hover:opacity-60 disabled:opacity-30">Undo</button>
            <button type="button" onClick={leave} className="transition-opacity duration-300 hover:opacity-60">New game</button>
          </nav>
          <nav className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] flex gap-5 text-[14px] md:right-8 md:gap-7" style={fade(inLesson && !learning)}>
            <button type="button" onClick={() => g?.hint()} disabled={ls?.solved != null || !!ls?.failed}
              className="transition-opacity duration-300 hover:opacity-60 disabled:opacity-30">Hint</button>
            <button type="button" onClick={() => lesson && study(lesson)} className="transition-opacity duration-300 hover:opacity-60">Retry</button>
            <button type="button" onClick={() => setLearning(true)} className="transition-opacity duration-300 hover:opacity-60">Lessons</button>
          </nav>
        </header>

        {/* On foot: how to move, said once. */}
        <p className="absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] px-5 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-soft"
          style={fade(hint && walking, 700)}>
          {TOUCH ? 'Drag to look · tap the ground to walk there' : 'Drag to look · W A S D to walk · shift to hurry · click the ground to go there'}
        </p>

        {/* ── Intro ─────────────────────────────────────────────────────── */}
        <section className="absolute bottom-0 left-0 w-full max-w-[640px] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pb-10" style={fade(intro, 1200)}>
          <h1 className="font-display text-[52px] font-light leading-[0.95] tracking-[-0.03em] md:text-[92px]"
            style={{ textShadow: `0 2px 40px rgba(${veil},0.85)` }}>Mexica Chess</h1>
          <p className="mt-4 max-w-[36ch] text-[16px] leading-[1.5] text-soft md:text-[17px]">
            {CARVING[carving].line} {WHERE[place].line}
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            <Segmented label="Carved in" labelWidth="5.5rem" tone={tone} options={CARVINGS.map(c => CARVING[c].label)}
              index={CARVINGS.indexOf(carving)} onSelect={i => changeCarving(CARVINGS[i])} />
            <Segmented label="You play" labelWidth="5.5rem" tone={tone} options={[CARVING[carving].sides.w, CARVING[carving].sides.b]}
              index={SIDES.indexOf(settings.side)} onSelect={i => setSettings(s => ({ ...s, side: SIDES[i] }))} />
            <Segmented label="Against" labelWidth="5.5rem" tone={tone} options={['The machine', 'A friend']}
              index={MODES.indexOf(settings.mode)} onSelect={i => setSettings(s => ({ ...s, mode: MODES[i] }))} />
            <div style={{ opacity: settings.mode === 'machine' ? 1 : 0.3, transition: `opacity 400ms ${EASE}` }}>
              <Segmented label="Level" labelWidth="5.5rem" tone={tone} options={['Easy', 'Medium', 'Hard']}
                index={LEVELS.indexOf(settings.level)} onSelect={i => setSettings(s => ({ ...s, level: LEVELS[i] }))} />
            </div>
            <Segmented label="Place" labelWidth="5.5rem" tone={tone} options={['Tenochtitlan', 'Calakmul']}
              index={PLACES.indexOf(place)} onSelect={i => changePlace(PLACES[i])} />
            <Segmented label="Hour" labelWidth="5.5rem" tone={tone} options={['Night', 'Day']}
              index={day ? 1 : 0} onSelect={i => changeHour(i === 1)} />
          </div>
          <div className="mt-8 flex items-center gap-3">
            <button type="button" onClick={() => g?.start(settings)}
              className="rounded-full bg-ink px-7 py-3 text-[15px] text-paper transition-[opacity,transform] duration-300 hover:opacity-85 active:scale-[0.98]">
              Play
            </button>
            <button type="button" onClick={() => setLearning(true)}
              className="rounded-full border border-line px-6 py-3 text-[15px] transition-[background-color,transform] duration-300 hover:bg-line active:scale-[0.98]">
              {Object.keys(progress.cacao).length ? 'Keep learning' : 'Learn to play'}
            </button>
          </div>
          <a href="/about" className="mt-5 inline-block text-[14px] text-soft transition-opacity duration-300 hover:opacity-60">About this experiment</a>
        </section>

        {/* ── Lesson ────────────────────────────────────────────────────── */}
        <section data-hud="lesson" className="absolute bottom-0 left-0 w-full max-w-[560px] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-8 md:pb-9"
          style={{ ...fade(inLesson && !learning, 800), pointerEvents: 'none' }}>
          {/* The text lets clicks through to the board; only its buttons take them. */}
          {lesson && (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">
                {String(lessonIndex + 1).padStart(2, '0')} · {CHAPTERS.find(c => c.id === lesson.chapter)?.title}
                {lesson.kind === 'clear' && ` · moves ${ls?.moves ?? 0} · best ${lesson.par}`}
                {lesson.kind === 'hunt' && ` · move ${ls?.moves ?? 0} of ${lesson.within}`}
              </p>
              <h2 className="mt-2 flex items-center gap-3 font-display text-[30px] font-light leading-none tracking-[-0.02em] md:text-[44px]">
                {lesson.title}
                {view?.thinking && <span aria-hidden className="mc-breathe inline-block h-2 w-2 rounded-full bg-ink" />}
              </h2>
              <p className="mt-3 max-w-[46ch] text-[15px] leading-[1.5] text-soft">{lesson.brief}</p>
              <p aria-live="polite" className="mt-3 min-h-[1.5em] max-w-[46ch] text-[15px] leading-[1.5]"
                style={{ color: ls?.feedback?.tone === 'bad' ? (day ? '#a8361c' : '#f0906e') : undefined }}>
                {ls?.feedback?.text}
              </p>
              {ls?.solved != null && (
                <div className="mt-4 flex flex-wrap items-center gap-5" style={{ pointerEvents: learning ? 'none' : 'auto' }}>
                  <Beans n={ls.solved} size={12} />
                  {following
                    ? <button type="button" onClick={() => study(following)}
                        className="rounded-full bg-ink px-6 py-2.5 text-[15px] text-paper transition-opacity duration-300 hover:opacity-85">Next: {following.title}</button>
                    : <button type="button" onClick={() => setLearning(true)}
                        className="rounded-full bg-ink px-6 py-2.5 text-[15px] text-paper transition-opacity duration-300 hover:opacity-85">All lessons</button>}
                </div>
              )}
              {ls?.failed && (
                <button type="button" onClick={() => study(lesson)} style={{ pointerEvents: learning ? 'none' : 'auto' }}
                  className="mt-4 rounded-full bg-ink px-6 py-2.5 text-[15px] text-paper transition-opacity duration-300 hover:opacity-85">Try again</button>
              )}
            </>
          )}
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

        {/* The view: on foot or above, the hour, the sound. */}
        <div className={`absolute right-5 flex flex-col items-end gap-2.5 font-mono text-[11px] uppercase tracking-[0.12em] md:right-8 ${inLesson ? 'max-md:hidden' : ''}`}
          style={{ bottom: playing ? 'max(4.5rem, calc(env(safe-area-inset-bottom) + 3.25rem))' : 'max(1.5rem, env(safe-area-inset-bottom))', ...fade(!!view && !over && !learning) }}>
          {(playing || inLesson) && (
            <button type="button" onClick={() => changeWalk(!walking)} disabled={moving}
              className="transition-opacity duration-300 hover:opacity-60 disabled:opacity-40">{walking ? 'Rise above' : 'Walk the board'}</button>
          )}
          {(playing || inLesson) && (
            <button type="button" onClick={() => changeHour(!day)} disabled={moving}
              className="transition-opacity duration-300 hover:opacity-60 disabled:opacity-40">{day ? 'Nightfall' : 'Daybreak'}</button>
          )}
          <button type="button" onClick={mute} className="text-soft transition-opacity duration-300 hover:opacity-60">
            {muted ? 'Sound on' : 'Mute'}
          </button>
        </div>

        {/* Promotion: the pawn reached the far rank. */}
        <div className="absolute inset-0 flex items-center justify-center px-5" style={fade(!!view?.promoting, 500)}>
          <div className="rounded-[28px] border border-line bg-glass p-6 backdrop-blur-xl md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">Your pawn reached the far side</p>
            <p className="mt-2 font-display text-[28px] font-light tracking-[-0.02em]">It becomes</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {CROWNS.map(k => (
                <button key={k} type="button" onClick={() => g?.promote(k)}
                  className="rounded-2xl border border-line px-4 py-3 text-left transition-colors duration-300 hover:bg-line">
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
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <button type="button" onClick={again}
              className="rounded-full bg-ink px-7 py-3 text-[15px] text-paper transition-opacity duration-300 hover:opacity-85">Play again</button>
            <button type="button" onClick={() => g?.undo()} className="text-[14px] transition-opacity hover:opacity-60">Take back</button>
            <button type="button" onClick={leave} className="text-[14px] transition-opacity hover:opacity-60">Change sides</button>
          </div>
        </div>
      </div>

      <Learn open={learning} progress={progress} current={lesson?.id ?? null} onPick={study} onClose={() => setLearning(false)} />
    </>
  );
}
