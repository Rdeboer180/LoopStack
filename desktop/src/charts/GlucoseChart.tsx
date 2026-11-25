// Glucose over the day, with the person's own in-range band always drawn (DM-2; Settings → Your ranges).
// Solid ground: the chart itself is never glass (GLASS-1).
import type { Pt } from '../data/current';
import { BANDS } from '../data/ranges';
import { hourTick } from '../data/derive';

export interface Series {
  pts: readonly Pt[];
  stroke: string;
  width: number;
  dash?: string;
  opacity?: number;
}

export interface ChartGeom {
  W: number;
  H: number;
  x0: number;
  x1: number;
  ymin?: number;
  ymax?: number;
}

const PAD = { L: 30, R: 6, T: 8, B: 18 };

export function scales({ W, H, x0, x1, ymin = 40, ymax = 300 }: ChartGeom) {
  const pw = W - PAD.L - PAD.R;
  const ph = H - PAD.T - PAD.B;
  return {
    pw,
    ph,
    X: (h: number) => PAD.L + ((h - x0) / (x1 - x0)) * pw,
    Y: (v: number) => PAD.T + (1 - (v - ymin) / (ymax - ymin)) * ph,
  };
}

export function GlucoseChart({ geom, series, band = [BANDS.low, BANDS.high], scope, label }: {
  geom: ChartGeom;
  series: Series[];
  band?: [number, number];
  scope?: readonly [number, number];
  label: string;
}) {
  const { W, H, x0, x1 } = geom;
  const { X, Y, pw, ph } = scales(geom);
  const step = x1 - x0 > 8 ? 3 : 2;
  const ticks: number[] = [];
  for (let h = Math.ceil(x0 / step) * step; h < x1 || (h === x1 && x1 < 24); h += step) ticks.push(h);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      {scope && <rect x={X(scope[0])} y={PAD.T} width={X(scope[1]) - X(scope[0])} height={ph} style={{ fill: 'var(--accent-info-soft)' }} />}
      <rect x={PAD.L} y={Y(band[1])} width={pw} height={Y(band[0]) - Y(band[1])} style={{ fill: 'var(--range-in-soft)' }} />
      {band.map((v) => (
        <g key={v}>
          <line x1={PAD.L} x2={PAD.L + pw} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--range-in)' }} strokeWidth="1" opacity="0.6" />
          <text x={PAD.L - 5} y={Y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>
        </g>
      ))}
      {series.map((s, i) => (
        <path
          key={i}
          d={`M${s.pts.map(([h, v]) => `${X(h).toFixed(1)} ${Y(v).toFixed(1)}`).join(' L')}`}
          fill="none"
          style={{ stroke: s.stroke }}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={s.dash}
          opacity={s.opacity ?? 1}
        />
      ))}
      {ticks.map((h) => (
        <text key={h} x={X(h)} y={H - 4} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{hourTick(((h % 24) + 24) % 24)}</text>
      ))}
    </svg>
  );
}
