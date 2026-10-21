import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Segmented — the one option picker of the lab.
 *
 * The label sits outside, small and quiet: it names the choice, it is not a
 * button. The options live in a hairline capsule, and a filled pill slides to
 * the selected one, so what is chosen is never in doubt.
 */
export default function Segmented({ label, options, index, onSelect, tone = 'dark', labelWidth }: {
  label: string;
  options: string[];
  index: number;
  onSelect: (i: number) => void;
  tone?: 'light' | 'dark';
  /** Fixed label column so stacked pickers line up. */
  labelWidth?: string;
}) {
  const dark = tone === 'dark';
  const ink = dark ? '#ece6da' : '#16130e';
  const paper = dark ? '#0b0a08' : '#f4efe3';
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  // Measure the selected option so the pill can travel to it.
  useLayoutEffect(() => {
    const measure = () => {
      const el = track.current?.children[index + 1] as HTMLElement | undefined;
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Webfonts change option widths once they land.
    document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [index, options.length]);

  return (
    <div className="flex items-center gap-3 max-w-full">
      <span
        className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] select-none"
        style={{ color: ink, opacity: 0.45, minWidth: labelWidth }}
      >
        {label}
      </span>
      <div
        className="min-w-0 overflow-x-auto rounded-full [scrollbar-width:none]"
        style={{
          border: `1px solid ${dark ? 'rgba(236,230,218,0.18)' : 'rgba(22,19,14,0.16)'}`,
          background: dark ? 'rgba(11,10,8,0.35)' : 'rgba(244,239,227,0.5)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <div ref={track} role="radiogroup" aria-label={label} className="relative flex items-center p-1 w-max">
          <span
            aria-hidden
            className="absolute top-1 bottom-1 left-0 rounded-full transition-[transform,width] duration-500"
            style={{
              background: ink,
              width: pill?.w ?? 0,
              transform: `translateX(${pill?.x ?? 0}px)`,
              opacity: pill ? 1 : 0,
              transitionTimingFunction: 'cubic-bezier(.16,1,.3,1)',
            }}
          />
          {options.map((o, i) => {
            const on = i === index;
            return (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onSelect(i)}
                className="cm-seg relative z-[1] shrink-0 rounded-full px-3 sm:px-3.5 py-1.5 text-[13px] leading-none whitespace-nowrap transition-colors duration-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
                style={{ color: on ? paper : ink, ['--seg-hover' as string]: dark ? 'rgba(236,230,218,0.1)' : 'rgba(22,19,14,0.07)' }}
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
