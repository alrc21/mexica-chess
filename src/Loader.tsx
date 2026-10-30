import { TEOCALLI, WORDMARK } from './marks';

const EASE = 'cubic-bezier(.16,1,.3,1)';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/** Where each stage tops out on the mark's grid: the plinth, four terraces, the shrines, their roofs. */
const TOP = [19.6, 16.8, 14.6, 12.4, 9.8, 6, 0];
// Paper grain, as on the brand sheets: monochrome noise, barely there.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/**
 * The curtain while the stone loads. The Templo Mayor rises as it did, in
 * seven stages, each temple built over the last: what is still to come is a
 * plan line, what stands is lime. The seventh tops it out and the curtain lifts.
 */
export default function Loader({ stage, shown, sides }: { stage: number; shown: boolean; sides: string }) {
  const clip = Math.max(0, (TOP[stage - 1] * 10 - 39) / 181 * 100);
  const mark = 'block w-[100px] md:w-[133px]';
  return (
    <div role="progressbar" aria-label="Loading" aria-valuemin={1} aria-valuemax={7} aria-valuenow={stage}
      className="pointer-events-none fixed inset-0 z-[60] bg-paper font-mono text-[10px] uppercase tracking-[0.12em] text-ink md:text-[11px]"
      style={{ opacity: shown ? 1 : 0, transition: `opacity 1600ms ${EASE}` }}>
      <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: GRAIN }} />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[30px] pb-[5svh] md:gap-[38px]">
        <div className="relative">
          <svg aria-hidden viewBox={TEOCALLI.viewBox} className={mark}>
            <path d={TEOCALLI.d} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
          <svg aria-hidden viewBox={TEOCALLI.viewBox} className={`absolute inset-0 ${mark}`}
            style={{ clipPath: `inset(${clip}% 0 0 0)`, transition: `clip-path 900ms ${EASE}` }}>
            <path d={TEOCALLI.d} fill="currentColor" />
          </svg>
        </div>
        <svg role="img" aria-label="Mexica Chess" viewBox={WORDMARK.viewBox} className="block w-[220px] md:w-[300px]">
          <path d={WORDMARK.d} fill="currentColor" />
        </svg>
      </div>

      <p className="absolute left-5 top-[max(1.25rem,env(safe-area-inset-top))] text-soft md:left-8 md:top-8">
        Tenochtitlan<span className="max-md:hidden"> · 19°26′N 99°08′W</span>
      </p>
      <p className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] text-soft md:right-8 md:top-8">{sides}</p>
      <p className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-5 leading-[1.6] text-soft md:bottom-8 md:left-8">
        <span className="md:hidden">Raised in seven stages</span>
        <span className="max-md:hidden">The Templo Mayor was raised in seven stages,<br />each temple built over the last.</span>
      </p>
      <p className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 md:bottom-8 md:right-8">{ROMAN[stage - 1]} / VII</p>
    </div>
  );
}
