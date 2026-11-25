// One ring per day with the day's in-range percent in the middle: the same
// treatment as the phone's "Last 7 days" card, and the same thresholds, so a
// green day means the same thing on both. Colour follows the percent (70+
// green, 50-69 amber, under 50 red) and the number is always printed, so
// colour is never the only cue (COL-5). Observations only (SAFE-1).
import type { DailyGlucose } from '../data/dataset';

const R = 13;
const C = 2 * Math.PI * R;

export function ringStroke(pct: number): string {
  return pct >= 70 ? 'var(--range-in)' : pct >= 50 ? 'var(--range-high)' : 'var(--range-low)';
}

export function DayRing({ pct, size = 44 }: { pct: number | null; size?: number }) {
  const empty = pct == null;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const dash = (C * v) / 100;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="day-ring">
      <circle cx="16" cy="16" r={R} fill="none" style={{ stroke: 'var(--ink-200)' }} strokeWidth="3.5" />
      {!empty && v > 0 && (
        <circle cx="16" cy="16" r={R} fill="none" style={{ stroke: ringStroke(Math.round(v)) }} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${dash} ${C - dash + 1}`} transform="rotate(-90 16 16)" />
      )}
      <text x="16" y="19.5" textAnchor="middle" fontSize="10" fontWeight="600" style={{ fill: empty ? 'var(--ink-500)' : 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{empty ? '·' : Math.round(v)}</text>
    </svg>
  );
}

/** "Fri, Oct 30" -> "Fri"; the date follows when the strip spans more than a week. */
function short(label: string, dated: boolean): string {
  const [wd, rest] = label.split(', ');
  return dated && rest ? `${wd} ${rest.split(' ')[1] ?? ''}`.trim() : wd;
}

/** Past this many days, one ring per day becomes a wall: the strip shows one ring per week instead. */
export const WEEKLY_OVER_DAYS = 35;

export interface WeekRing { label: string; pct: number | null; counted: number; days: number }
/**
 * Days grouped into weeks, newest week ending on the last day, oldest week possibly short.
 * A week's figure is the mean of its counted days; with fewer than 4 counted it isn't read.
 */
export function weekRings(days: readonly DailyGlucose[]): WeekRing[] {
  const out: WeekRing[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const wk = days.slice(Math.max(0, end - 7), end);
    const counted = wk.filter((d) => d.usable && d.inRangePct != null);
    const first = wk[0];
    const label = first.label.split(', ')[1] ?? first.day;
    out.unshift({ label, pct: counted.length >= 4 ? counted.reduce((t, d) => t + d.inRangePct!, 0) / counted.length : null, counted: counted.length, days: wk.length });
  }
  return out;
}

export function DayRings({ days, today, size = 44 }: { days: readonly DailyGlucose[]; today?: DailyGlucose | null; size?: number }) {
  if (days.length > WEEKLY_OVER_DAYS) {
    const weeks = weekRings(days);
    const label = `In range by week, ${weeks.length} weeks: ${weeks.map((w) => `week of ${w.label} ${w.pct == null ? 'not enough days' : `${Math.round(w.pct)}%`}`).join(', ')}`;
    return (
      <div className="day-rings weekly" role="img" aria-label={label} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(size + 8, 60)}px, 1fr))` }}>
        {weeks.map((w) => (
          <div key={w.label} className="day-ring-cell" title={w.pct == null ? `${w.counted} of ${w.days} days counted: not enough to read` : `${w.counted} of ${w.days} days counted`}>
            <DayRing pct={w.pct} size={size} />
            <span className="day-ring-label">{w.label}</span>
          </div>
        ))}
      </div>
    );
  }
  const rows = today ? [...days, today] : [...days];
  const dated = rows.length > 7;
  const counted = rows.filter((d) => d.inRangePct != null && (d.usable || d === today));
  const label = counted.length
    ? `In range by day: ${counted.map((d) => `${d.label} ${Math.round(d.inRangePct!)}%`).join(', ')}`
    : 'No days counted yet';
  return (
    <div className="day-rings" role="img" aria-label={label} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(size + 8, 60)}px, 1fr))` }}>
      {rows.map((d, i) => {
        const isToday = today != null && i === rows.length - 1;
        const ok = d.inRangePct != null && (d.usable || isToday);
        return (
          <div key={`${d.day}-${i}`} className={`day-ring-cell${isToday ? ' today' : ''}`} title={ok ? undefined : 'Not counted'}>
            <DayRing pct={ok ? d.inRangePct : null} size={size} />
            <span className="day-ring-label">{short(d.label, dated)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The short key under a ring row. */
export const RING_KEY = 'Green 70 or more · amber 50 to 69 · red under 50 · a dot is a day without 2 hours of readings.';
/** The key, matched to what the strip is showing. */
export const ringKey = (n: number) => (n > WEEKLY_OVER_DAYS
  ? 'One ring per week, labelled by its first day: the average of its counted days. Green 70 or more · amber 50 to 69 · red under 50 · a dot is a week with fewer than 4 counted days.'
  : RING_KEY);

/**
 * The phone's takeaway rule: name the weakest counted day only when it sits
 * 15 or more points under the period's figure. Today is left out (it's partial).
 * Observations only (SAFE-1).
 */
export function weakestDay(days: readonly DailyGlucose[], periodPct: number): string | null {
  const counted = days.filter((d) => d.usable && d.inRangePct != null);
  if (counted.length < 2) return null;
  const worst = counted.reduce((w, d) => (d.inRangePct! < w.inRangePct! ? d : w));
  return worst.inRangePct! <= periodPct - 15 ? `${worst.label} was lowest at ${Math.round(worst.inRangePct!)}% in range.` : null;
}

/** One sentence before the rings: the period's figure, then the weakest day when it stands out. */
export function ringTakeaway(days: readonly DailyGlucose[], periodPct: number): string {
  const counted = days.filter((d) => d.usable && d.inRangePct != null).length;
  if (!counted) return 'No days counted yet.';
  const base = `${Math.round(periodPct)}% in range over ${counted} counted ${counted === 1 ? 'day' : 'days'}.`;
  const weak = weakestDay(days, periodPct);
  return weak ? `${base} ${weak}` : base;
}
