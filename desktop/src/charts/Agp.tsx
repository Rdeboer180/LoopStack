// The AGP curve and the five-band time-in-range bar, in the layout clinicians
// already read (VIS-10). Solid ground, never glass (GLASS-1).
import { AGP, PERIOD, READ } from '../data/current';
import { hourTick } from '../data/derive';
import { BANDS, VERY_HIGH } from '../data/ranges';

const PAD = { L: 34, R: 10, T: 10, B: 20 };
const BANDS_TEXT = '70 to 180';

export function AgpChart({ W, H }: { W: number; H: number }) {
  const pw = W - PAD.L - PAD.R;
  const ph = H - PAD.T - PAD.B;
  const X = (h: number) => PAD.L + (h / 24) * pw;
  const Y = (g: number) => PAD.T + ((300 - g) / 260) * ph;
  const band = (lo: readonly number[], hi: readonly number[]) =>
    `M${AGP.hours.map((h, i) => `${X(h).toFixed(1)} ${Y(hi[i]).toFixed(1)}`).join('L')}L${[...AGP.hours].reverse().map((h, i) => `${X(h).toFixed(1)} ${Y(lo[lo.length - 1 - i]).toFixed(1)}`).join('L')}Z`;
  // Said from the curve itself, so it holds for any period or person.
  const med = AGP.p50.filter((v) => v > 0);
  const at = (arr: readonly number[], pick: (a: number, b: number) => boolean) => arr.reduce((bi, v, k) => (v > 0 && (bi < 0 || pick(v, arr[bi])) ? k : bi), -1);
  const lo = at(AGP.p5, (a, b) => a < b), hi = at(AGP.p95, (a, b) => a > b);
  const hourWord = (h: number) => hourTick(h % 24);
  const label = med.length
    ? `AGP, ${PERIOD.days} days, glucose by time of day. The median runs from ${Math.min(...med)} to ${Math.max(...med)} mg/dL. The 5th percentile is lowest, ${AGP.p5[lo]} mg/dL, around ${hourWord(AGP.hours[lo])}; the 95th is highest, ${AGP.p95[hi]} mg/dL, around ${hourWord(AGP.hours[hi])}. ${BANDS_TEXT} shaded.`
    : `AGP, ${PERIOD.days} days: not enough readings to draw.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={PAD.L} y={Y(180)} width={pw} height={Y(70) - Y(180)} style={{ fill: 'var(--range-in-soft)' }} />
      <path d={band(AGP.p5, AGP.p95)} style={{ fill: 'var(--surface-2)' }} />
      <path d={band(AGP.p25, AGP.p75)} style={{ fill: 'var(--ink-300)' }} opacity="0.8" />
      {[70, 180].map((v) => (
        <g key={v}>
          <line x1={PAD.L} x2={PAD.L + pw} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--brand-primary-hover)' }} strokeWidth="1.5" />
          <text x={PAD.L - 5} y={Y(v) + 4} fontSize="11" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>
        </g>
      ))}
      <path d={`M${AGP.hours.map((h, i) => `${X(h).toFixed(1)} ${Y(AGP.p50[i]).toFixed(1)}`).join('L')}`} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.5" strokeLinejoin="round" />
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <text key={h} x={X(h)} y={H - 4} fontSize="11" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} style={{ fill: 'var(--ink-700)' }}>{hourTick(h % 24)}</text>
      ))}
    </svg>
  );
}

/** Which bands to read: yours (Settings → Your ranges) for the dashboard, or the standard report's for the care-team review. */
export type BandSet = 'mine' | 'standard';

export const bands = (set: BandSet = 'standard') => {
  if (set === 'standard') return [
    { key: 'very-high', label: 'Very high', range: `over ${VERY_HIGH}`, pct: READ.veryHighPct, fill: 'var(--range-very-high)' },
    { key: 'high', label: 'High', range: '181–250', pct: READ.highPct, fill: 'var(--range-high)' },
    { key: 'in', label: 'In range', range: '70–180', pct: READ.inRangePct, fill: 'var(--range-in)' },
    { key: 'low', label: 'Low', range: '54–69', pct: READ.lowPct, fill: 'var(--range-low)' },
    { key: 'very-low', label: 'Very low', range: 'under 54', pct: READ.veryLowPct, fill: 'var(--range-very-low)' },
  ] as const;
  const m = READ.mine;
  const b = BANDS;
  // The phone's names from Profile → Targets: urgent low, low, in range.
  return [
    { key: 'very-high', label: 'Very high', range: `over ${VERY_HIGH}`, pct: m.veryHighPct, fill: 'var(--range-very-high)' },
    { key: 'high', label: 'High', range: `${b.high + 1}–${VERY_HIGH}`, pct: m.highPct, fill: 'var(--range-high)' },
    { key: 'in', label: 'In range', range: `${b.low}–${b.high}`, pct: m.inRangePct, fill: 'var(--range-in)' },
    { key: 'low', label: 'Low', range: `${b.urgentLow}–${b.low - 1}`, pct: m.lowPct, fill: 'var(--range-low)' },
    { key: 'very-low', label: 'Urgent low', range: `under ${b.urgentLow}`, pct: m.urgentPct, fill: 'var(--range-very-low)' },
  ] as const;
};

/** The stacked five-band bar, high at the top as on the AGP report. Labels carry the numbers (COL-5). */
export function TirBar({ W, H, labels = true, set = 'standard' }: { W: number; H: number; labels?: boolean; set?: BandSet }) {
  const barW = Math.min(36, W * 0.3);
  // Tiny bands still get 3px so they stay visible.
  const min = 3;
  const total = bands(set).reduce((t, b) => t + Math.max(min, (b.pct / 100) * H), 0);
  let y = 0;
  const label = `Time in range, ${PERIOD.days} days: ${bands(set).map((b) => `${b.label.toLowerCase()} ${b.pct}%`).join(', ')}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      {bands(set).map((b) => {
        const h = (Math.max(min, (b.pct / 100) * H) / total) * H;
        const y0 = y;
        y += h;
        return (
          <g key={b.key}>
            <rect x="0" y={y0} width={barW} height={Math.max(1, h - 1)} rx="2" style={{ fill: b.fill }} />
            {labels && (
              <text x={barW + 10} y={Math.min(H - 3, Math.max(11, y0 + h / 2 + 4))} fontSize={b.key === 'in' ? 13 : 11} fontWeight={b.key === 'in' ? 600 : 400} style={{ fill: b.key === 'in' ? 'var(--ink-900)' : 'var(--ink-700)' }}>
                {b.label} {b.pct}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
