// Daily glucose: one column per day, oldest first, today last. Each column is
// that day's spread: a thin line from the 5th to the 95th percentile, a bar
// for the middle half, and a dot for the average, labelled in the detail.
// One locked scale, 40–300 mg/dL (VIS-1); your in-range band always drawn
// (DM-2); a day not counted is hatched and says so (VIS-4).
import type { DailyGlucose } from '../data/current';
import { BANDS, type Bands } from '../data/ranges';

const PAD = { L: 30, R: 8, T: 10, B: 22 };
const YMIN = 40;
const YMAX = 300;

export function DailyChart({ days, today, W, H, values = false, sel = null, band = BANDS }: {
  /** Your bands on the dashboard; the care-team review passes the standard ones. */
  band?: Bands;
  days: readonly DailyGlucose[];
  today: DailyGlucose | null;
  W: number;
  H: number;
  /** Write each day's average above its dot (the detail face). */
  values?: boolean;
  sel?: number | null;
}) {
  const cols = today ? [...days, today] : [...days];
  const pw = W - PAD.L - PAD.R;
  const ph = H - PAD.T - PAD.B;
  const cw = pw / Math.max(1, cols.length);
  const x = (i: number) => PAD.L + (i + 0.5) * cw;
  const y = (v: number) => PAD.T + ((YMAX - Math.min(YMAX, Math.max(YMIN, v))) / (YMAX - YMIN)) * ph;
  const bar = Math.max(2, Math.min(16, cw * 0.5));
  // A label every ~32px, so 90 and 180 days don't pile their dates on top of each other.
  const every = Math.max(1, Math.ceil(32 / cw));
  const counted = days.filter((d) => d.usable && d.meanMgdl != null);
  const mean = counted.length ? Math.round(counted.reduce((t, d) => t + (d.meanMgdl ?? 0), 0) / counted.length) : null;
  const label = [
    `Daily glucose, ${days.length} days${today ? ' and today so far' : ''}.`,
    mean != null ? `The average across ${counted.length} counted days is ${mean} mg/dL.` : '',
    ...cols.map((d) => (d.meanMgdl == null || !d.usable && d !== today ? `${d.label}: not counted.` : `${d.label}: average ${d.meanMgdl} mg/dL, middle half ${d.p25}–${d.p75}, ${d.inRangePct}% in range.`)),
  ].join(' ');
  const fill = (v: number) => (v < band.low ? 'var(--range-low)' : v > band.high ? 'var(--range-high)' : 'var(--range-in)');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <defs>
        <pattern id="daily-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--ink-300)' }} strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect x={PAD.L} y={y(band.high)} width={pw} height={y(band.low) - y(band.high)} style={{ fill: 'var(--range-in-soft)' }} />
      {[band.low, band.high].map((v) => (
        <g key={v}>
          <line x1={PAD.L} x2={PAD.L + pw} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--range-in)' }} strokeWidth="1" opacity="0.6" />
          <text x={PAD.L - 6} y={y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>
        </g>
      ))}
      {mean != null && <line x1={PAD.L} x2={PAD.L + pw - (today ? cw : 0)} y1={y(mean)} y2={y(mean)} style={{ stroke: 'var(--ink-700)' }} strokeWidth="1" strokeDasharray="3 3" />}
      {cols.map((d, i) => {
        const cx = x(i);
        const isToday = today != null && i === cols.length - 1;
        const missing = d.meanMgdl == null || (!d.usable && !isToday);
        return (
          <g key={`${d.day}-${i}`} opacity={sel != null && sel !== i ? 0.45 : 1}>
            {isToday && <rect x={cx - cw / 2 + 1} y={PAD.T} width={cw - 2} height={ph} rx="4" fill="none" style={{ stroke: 'var(--ink-300)' }} strokeDasharray="3 3" />}
            {missing ? (
              <rect x={cx - bar / 2} y={PAD.T} width={bar} height={ph} rx="2" fill="url(#daily-hatch)" />
            ) : (
              <>
                <line x1={cx} x2={cx} y1={y(d.p95!)} y2={y(d.p5!)} style={{ stroke: 'var(--ink-500)' }} strokeWidth="1.2" />
                <rect x={cx - bar / 2} y={y(d.p75!)} width={bar} height={Math.max(2, y(d.p25!) - y(d.p75!))} rx={Math.min(bar / 2, 6)} style={{ fill: 'var(--surface-0)', stroke: 'var(--ink-500)' }} strokeWidth="1" />
                <circle cx={cx} cy={y(d.meanMgdl!)} r={Math.max(3, Math.min(5, bar / 2.5))} style={{ fill: fill(d.meanMgdl!), stroke: 'var(--surface-0)' }} strokeWidth="1.2" />
                {values && (cw >= 22 || sel === i) && <text x={cx} y={y(d.p95!) - 4} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-900)' }}>{d.meanMgdl}</text>}
              </>
            )}
            {/* A regular date never sits under Today's label. */}
            {(isToday || (i % every === 0 && !(today && i > cols.length - 1 - every))) && (
              <text x={cx} y={H - 6} fontSize="10" textAnchor="middle" fontWeight={isToday ? 600 : 400} style={{ fill: 'var(--ink-700)' }}>{isToday ? 'Today' : d.day}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
