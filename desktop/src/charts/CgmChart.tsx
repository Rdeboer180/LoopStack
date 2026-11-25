// Glucose now, drawn the way Loop and Dexcom draw it (Nov 24): one dot per CGM reading,
// your low and high as labelled lines, hours along the bottom, a Now line, and Loop's
// prediction dashed past it. Dots below your low are red and above your high amber, and
// their position against the labelled lines says the same thing (COL-5). Hover or focus
// a reading for its time and value. Solid ground (GLASS-1). Observations only (SAFE-1).
import { useState, type PointerEvent } from 'react';
import type { Pt } from '../data/current';
import { BANDS, type Bands } from '../data/ranges';
import { hourTick } from '../data/derive';

const PAD = { L: 36, R: 40, T: 14, B: 24 };

/** The span a reading's hour falls in, as a clock label: -1.5 → "10:30p". */
export function clockOf(h: number): string {
  const day = ((h % 24) + 24) % 24;
  const hr = Math.floor(day);
  const min = Math.round((day - hr) * 60);
  const m = min === 60 ? 0 : min;
  const H = min === 60 ? hr + 1 : hr;
  return `${H % 12 || 12}:${String(m).padStart(2, '0')}${H % 24 < 12 ? 'a' : 'p'}`;
}

/** Hour-tick spacing for a window: 1h up to 6h, 2h to 12h, 3h beyond. */
export const tickStep = (span: number) => (span <= 6 ? 1 : span <= 12 ? 2 : 3);

/** The top of the scale: at least 250, rounded up to the next 50 above the highest reading, capped at 400 like a CGM. */
export function yTop(values: readonly number[]): number {
  const hi = values.length ? Math.max(...values) : 0;
  return Math.min(400, Math.max(250, Math.ceil((hi + 15) / 50) * 50));
}

export type Tone = 'low' | 'high' | 'in';
export const toneOf = (v: number, b: Pick<Bands, 'low' | 'high'>): Tone => (v < b.low ? 'low' : v > b.high ? 'high' : 'in');
const FILL: Record<Tone, string> = { low: 'var(--range-low)', high: 'var(--range-high)', in: 'var(--ink-900)' };

export function CgmChart({ W, H, readings, prediction = [], x0, x1, bands = BANDS, label, compact = false }: {
  W: number;
  H: number;
  readings: readonly Pt[];
  prediction?: readonly Pt[];
  /** The window, in hours relative to today's midnight. */
  x0: number;
  x1: number;
  bands?: Bands;
  label: string;
  /** The small tile version: no hover, fewer labels. */
  compact?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = compact ? { L: 26, R: 6, T: 6, B: 16 } : PAD;
  const shown = readings.filter(([h]) => h >= x0 && h <= x1);
  const pred = prediction.filter(([h]) => h >= x0 && h <= x1);
  const ymin = 40;
  const ymax = yTop([...shown, ...pred].map((p) => p[1]));
  const pw = Math.max(1, W - pad.L - pad.R);
  const ph = Math.max(1, H - pad.T - pad.B);
  const X = (h: number) => pad.L + ((h - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => pad.T + (1 - (Math.min(ymax, Math.max(ymin, v)) - ymin) / (ymax - ymin)) * ph;
  const span = x1 - x0;
  // Dots shrink as the window widens, so 24 hours of readings stay a line of dots, not a smear.
  const r = Math.max(1.4, Math.min(compact ? 2.4 : 3.6, (pw / Math.max(1, shown.length)) * 0.42));
  const step = tickStep(span);
  const ticks: number[] = [];
  for (let h = Math.ceil(x0 / step) * step; h <= x1 + 1e-6; h += step) ticks.push(h);
  const grid = [50, 100, 150, 200, 250, 300, 350, 400].filter((v) => v > ymin && v < ymax && Math.abs(v - bands.high) > 12 && Math.abs(v - bands.low) > 12);
  const last = shown[shown.length - 1] ?? null;
  const predPath = pred.length > 1 ? `M${pred.map(([h, v]) => `${X(h).toFixed(1)} ${Y(v).toFixed(1)}`).join(' L')}` : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (compact || !shown.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < shown.length; i++) if (Math.abs(X(shown[i][0]) - px) < Math.abs(X(shown[best][0]) - px)) best = i;
    setHover(best);
  };
  const hv = hover != null ? shown[hover] : null;
  const tipW = 92;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="cgm-chart" style={{ display: 'block' }}
      onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {/* Your range, faint, so the dots carry the picture. */}
      <rect x={pad.L} y={Y(bands.high)} width={pw} height={Y(bands.low) - Y(bands.high)} style={{ fill: 'var(--range-in-soft)' }} opacity="0.7" />
      {/* Hour gridlines and labels. */}
      {ticks.map((h) => (
        <g key={`t${h}`}>
          <line x1={X(h)} x2={X(h)} y1={pad.T} y2={pad.T + ph} style={{ stroke: 'var(--ink-200)' }} strokeWidth="1" />
          <text x={X(h)} y={H - (compact ? 3 : 6)} fontSize={compact ? 9 : 11} textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{hourTick(((Math.round(h) % 24) + 24) % 24)}</text>
        </g>
      ))}
      {/* A light scale on the left. */}
      {!compact && grid.map((v) => (
        <g key={`g${v}`}>
          <line x1={pad.L} x2={pad.L + pw} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--ink-200)' }} strokeWidth="1" strokeDasharray="2 4" />
          <text x={pad.L - 6} y={Y(v) + 4} fontSize="11" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>
        </g>
      ))}
      {/* Your low and high, labelled at the right like a CGM. */}
      {([['high', bands.high], ['low', bands.low]] as const).map(([k, v]) => (
        <g key={k}>
          <line x1={pad.L} x2={pad.L + pw} y1={Y(v)} y2={Y(v)} style={{ stroke: k === 'high' ? 'var(--range-high)' : 'var(--range-low)' }} strokeWidth="1.5" />
          <text x={compact ? pad.L - 4 : pad.L + pw + 6} y={Y(v) + 4} fontSize={compact ? 9 : 11} fontWeight="600" textAnchor={compact ? 'end' : 'start'} style={{ fill: 'var(--ink-900)' }}>{v}</text>
        </g>
      ))}
      {/* Now, and Loop's prediction past it. */}
      {last && predPath && (
        <g>
          <line x1={X(last[0])} x2={X(last[0])} y1={pad.T} y2={pad.T + ph} style={{ stroke: 'var(--ink-500)' }} strokeWidth="1" strokeDasharray="3 3" />
          {!compact && <text x={X(last[0]) + 4} y={pad.T + 10} fontSize="11" style={{ fill: 'var(--ink-700)' }}>Now</text>}
          <path d={predPath} fill="none" style={{ stroke: 'var(--ink-700)' }} strokeWidth={compact ? 1.4 : 1.8} strokeDasharray="4 4" strokeLinecap="round" />
        </g>
      )}
      {/* One dot per reading. */}
      {shown.map(([h, v], i) => (
        <circle key={i} cx={X(h)} cy={Y(v)} r={i === shown.length - 1 ? r + 1.2 : r} style={{ fill: FILL[toneOf(v, bands)] }} />
      ))}
      {last && <circle cx={X(last[0])} cy={Y(last[1])} r={r + 5} fill="none" style={{ stroke: FILL[toneOf(last[1], bands)] }} strokeWidth="1.5" opacity="0.35" />}
      {/* Hover: the reading's time and value. */}
      {hv && (
        <g pointerEvents="none">
          <line x1={X(hv[0])} x2={X(hv[0])} y1={pad.T} y2={pad.T + ph} style={{ stroke: 'var(--ink-500)' }} strokeWidth="1" />
          <circle cx={X(hv[0])} cy={Y(hv[1])} r={r + 2.5} style={{ fill: FILL[toneOf(hv[1], bands)], stroke: 'var(--surface-0)' }} strokeWidth="2" />
          <g transform={`translate(${Math.min(pad.L + pw - tipW, Math.max(pad.L, X(hv[0]) - tipW / 2))} ${Math.max(pad.T, Y(hv[1]) - 52)})`}>
            <rect width={tipW} height="40" rx="8" style={{ fill: 'var(--surface-0)', stroke: 'var(--ink-200)' }} />
            <text x="10" y="17" fontSize="13" fontWeight="600" style={{ fill: 'var(--ink-900)' }}>{hv[1]} mg/dL</text>
            <text x="10" y="32" fontSize="11" style={{ fill: 'var(--ink-700)' }}>{clockOf(hv[0])}</text>
          </g>
        </g>
      )}
    </svg>
  );
}
