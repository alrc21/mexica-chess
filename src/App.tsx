import { useEffect, useRef, useState } from 'react';
import { createStage } from './stage';

const EASE = 'cubic-bezier(.16,1,.3,1)';

/**
 * The stone owns the screen; the interface sits in the corners as plain type
 * and gets out of the way — the same chrome as Curated Motions.
 */
export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => createStage(canvas.current!, () => setReady(true)), []);

  return (
    <>
      <canvas ref={canvas} className="fixed inset-0 h-full w-full touch-none outline-none" />

      {/* Curtain: lifts once the stone has loaded and compiled. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-50 bg-paper"
        style={{ opacity: ready ? 0 : 1, transition: `opacity 1400ms ${EASE}` }}
      />

      <div className="pointer-events-none fixed inset-0 z-40 text-ink">
        <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8">
          <span className="font-display text-[17px] tracking-[-0.01em]">Mexica Chess</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-soft">Look development</span>
        </header>

        <footer className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-8">
          <div>
            <h1 className="font-display text-[40px] font-light leading-none tracking-[-0.02em] md:text-[56px]">Teocalli</h1>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-soft">
              The rook · Templo Mayor · Tezontle and basalt
            </p>
          </div>
          <span className="hidden text-[14px] text-soft md:block">Drag to turn</span>
        </footer>
      </div>
    </>
  );
}
