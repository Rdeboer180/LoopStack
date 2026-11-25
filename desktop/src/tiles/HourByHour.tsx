// Hour by hour: each hour of the day across the review period. For every hour, the median of the
// days' hourly glucose, and on how many of those days that hour ran below or above your band (Settings → Your ranges). Built
// from the same per-day hourly medians What Loop did uses (HOURLY_G), sliced by the shared day
// picker. An hour with fewer than 5 days of readings shows nothing rather than a guess.
// Observations only (SAFE-1): what the hours did, never what to change.
import { useState } from 'react';
import { DAYS, HOURLY_G, PERIOD } from '../data/current';
import { hourName } from '../data/derive';
import { DayPicker, dayPickName, downloadCsv, FocusBar, inPick, type DayPick, type FocusView } from '../ui/Focus';
import { Fit } from '../ui/kit';
import type { FaceProps } from './faces';
import { BANDS } from '../data/ranges';

/** Fewer days than this in an hour and it says nothing. */
export const MIN_DAYS = 5;

export interface HourRow { hour: number; median: number | null; low: number; high: number; days: number; /** Spread across the days: 10th, 25th, 75th and 90th percentiles; null with too few days. */ p10: number | null; p25: number | null; p75: number | null; p90: number | null }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)); };

/** The 24 hours for the days in the pick. Pure over the day labels and hourly medians, for testing. */
export function hourRows(days: readonly string[], hourly: Readonly<Record<string, readonly (number | null)[]>>, pick: DayPick): HourRow[] {
  const picked = days.filter((d) => inPick(d, pick));
  return Array.from({ length: 24 }, (_, hour) => {
    const vals = picked.map((d) => hourly[d]?.[hour]).filter((g): g is number => typeof g === 'number');
    const enough = vals.length >= MIN_DAYS;
    return {
      hour,
      median: enough ? Math.round(median(vals)) : null,
      p10: enough ? pct(vals, 0.1) : null,
      p25: enough ? pct(vals, 0.25) : null,
      p75: enough ? pct(vals, 0.75) : null,
      p90: enough ? pct(vals, 0.9) : null,
      low: vals.filter((g) => g < BANDS.low).length,
      high: vals.filter((g) => g > BANDS.high).length,
      days: vals.length,
    };
  });
}

const band = (g: number | null) => (g == null ? 'none' : g < BANDS.low ? 'low' : g > BANDS.high ? 'high' : 'in');

/** 24 cells, one per hour, shaded by where the median sat; a word and a number in each label. */
function Strip({ rows, big }: { rows: HourRow[]; big: boolean }) {
  return (
    <ol className={`hbh-strip${big ? ' big' : ''}`} aria-label="Median glucose by hour">
      {rows.map((r) => (
        <li key={r.hour} className={`hbh-cell ${band(r.median)}`} title={`${hourName(r.hour)}: ${r.median == null ? `${r.days} days, not enough` : `median ${r.median} mg/dL, below ${BANDS.low} on ${r.low} of ${r.days} days, above ${BANDS.high} on ${r.high}`}`}>
          <span className="sr-only">{hourName(r.hour)}: {r.median == null ? 'not enough days' : `${r.median} mg/dL`}</span>
          {big && <span className="hbh-val" aria-hidden="true">{r.median ?? '—'}</span>}
          {(big || r.hour % 3 === 0) && <span className="hbh-hour" aria-hidden="true">{hourName(r.hour)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The day's shape: median line, middle half and 10–90% shaded, your band behind. Gaps where an hour has too few days. */
function HourChart({ rows, W, H }: { rows: HourRow[]; W: number; H: number }) {
  const pad = { L: 34, R: 10, T: 10, B: 22 };
  const pw = W - pad.L - pad.R, ph = H - pad.T - pad.B;
  const vals = rows.flatMap((r) => [r.p10, r.p90]).filter((v): v is number => v != null);
  // Fit to the data, with your band always in view and a little room either side.
  const lo = Math.min(BANDS.low - 15, ...vals) - 5, hi = Math.max(BANDS.high + 15, ...vals) + 5;
  const X = (h: number) => pad.L + ((h + 0.5) / 24) * pw;
  const Y = (g: number) => pad.T + ((hi - g) / (hi - lo)) * ph;
  // Runs of hours with numbers, so a gap stays a gap.
  const runs: HourRow[][] = [];
  for (const r of rows) { if (r.median == null) { runs.push([]); continue; } (runs[runs.length - 1] ?? runs[runs.push([]) - 1]).push(r); }
  const area = (run: HourRow[], a: 'p10' | 'p25', b: 'p75' | 'p90') => `M${run.map((r) => `${X(r.hour).toFixed(1)} ${Y(r[b]!).toFixed(1)}`).join('L')}L${[...run].reverse().map((r) => `${X(r.hour).toFixed(1)} ${Y(r[a]!).toFixed(1)}`).join('L')}Z`;
  const line = (run: HourRow[]) => `M${run.map((r) => `${X(r.hour).toFixed(1)} ${Y(r.median!).toFixed(1)}`).join('L')}`;
  const read = rows.filter((r) => r.median != null);
  const label = read.length ? `Glucose by hour of day: median from ${Math.min(...read.map((r) => r.median!))} to ${Math.max(...read.map((r) => r.median!))} mg/dL; middle half and 10 to 90 percent of days shaded; ${BANDS.low} to ${BANDS.high} band behind.` : 'Not enough days to draw the hours.';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={pad.L} y={Y(BANDS.high)} width={pw} height={Y(BANDS.low) - Y(BANDS.high)} style={{ fill: 'var(--range-in-soft)' }} />
      {[BANDS.low, BANDS.high].map((v) => <text key={v} x={pad.L - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>)}
      {runs.filter((r) => r.length > 1).map((run, i) => (
        <g key={i}>
          <path d={area(run, 'p10', 'p90')} style={{ fill: 'var(--ink-300)' }} opacity="0.35" />
          <path d={area(run, 'p25', 'p75')} style={{ fill: 'var(--ink-300)' }} opacity="0.7" />
          <path d={line(run)} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.4" strokeLinejoin="round" />
        </g>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={X(h)} y={H - 6} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{hourName(h)}</text>)}
    </svg>
  );
}

function summary(rows: HourRow[], pick: DayPick): string {
  const read = rows.filter((r) => r.median != null);
  if (!read.length) return `Not enough ${dayPickName(pick)} in this period yet: an hour needs ${MIN_DAYS} days.`;
  const lo = read.reduce((a, r) => (r.median! < a.median! ? r : a));
  const hi = read.reduce((a, r) => (r.median! > a.median! ? r : a));
  const lowMost = read.reduce((a, r) => (r.low / r.days > a.low / a.days ? r : a));
  const tail = lowMost.low ? ` Below ${BANDS.low} most often at ${hourName(lowMost.hour)}: ${lowMost.low} of ${lowMost.days} days.` : '';
  return `Lowest at ${hourName(lo.hour)}, ${lo.median} mg/dL; highest at ${hourName(hi.hour)}, ${hi.median}.${tail}`;
}

export function HourByHourGlance({ go }: FaceProps) {
  const [pick, setPick] = useState<DayPick>('all');
  const rows = hourRows(DAYS, HOURLY_G, pick);
  return (
    <div className="face">
      <div className="row between wrap">
        <DayPicker compact value={pick} onChange={setPick} />
        <button type="button" className="text-btn" onClick={() => go({ tile: 'hour-by-hour' })}>Table</button>
      </div>
      <Strip rows={rows} big={false} />
      <p className="small">{summary(rows, pick)}</p>
    </div>
  );
}

export function HourByHourDetail() {
  const [pick, setPick] = useState<DayPick>('all');
  // The shape first (C2: pattern before raw rows); the table is one press away.
  const [view, setView] = useState<FocusView>('chart');
  const rows = hourRows(DAYS, HOURLY_G, pick);
  const csv = () => downloadCsv(`loopstack-hour-by-hour-${pick}-${PERIOD.days}d.csv`, ['Hour', 'Median (mg/dL)', `Days below ${BANDS.low}`, `Days above ${BANDS.high}`, 'Days with data'],
    rows.map((r) => [hourName(r.hour), r.median, r.low, r.high, r.days]));
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Hour by hour">
        <FocusBar covers={`${PERIOD.label} · ${PERIOD.days} days, the period in the top bar`} day={pick} onDay={setPick} view={view} onView={setView} onCsv={csv} />
        <p className="takeaway">{summary(rows, pick)}</p>
        {view === 'chart' ? (
          <>
            <Fit className="chart-md">{({ w, h }) => <HourChart rows={rows} W={w} H={h} />}</Fit>
            <span className="caption">Line: the median day · darker band: the middle half of days · lighter: 10–90% · {BANDS.low}–{BANDS.high} shaded</span>
            <Strip rows={rows} big />
          </>
        ) : (
          <div className="focus-table-wrap">
            <table className="table focus-table">
              <caption className="sr-only">Each hour across {dayPickName(pick)} in the period</caption>
              <thead><tr><th scope="col">Hour</th><th scope="col" className="num">Median, mg/dL</th><th scope="col" className="num">Below {BANDS.low}</th><th scope="col" className="num">Above {BANDS.high}</th><th scope="col" className="num">Days</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.hour}>
                  <th scope="row">{hourName(r.hour)}</th>
                  <td className={`num strong${r.median != null && r.median < BANDS.low ? ' low' : r.median != null && r.median > BANDS.high ? ' high' : ''}`}>{r.median ?? '—'}</td>
                  <td className="num">{r.days ? <>{Math.round((r.low / r.days) * 100)}% <span className="caption">{r.low} of {r.days}</span></> : '—'}</td>
                  <td className="num">{r.days ? <>{Math.round((r.high / r.days) * 100)}% <span className="caption">{r.high} of {r.days}</span></> : '—'}</td>
                  <td className="num">{r.days}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="panel stack-12" aria-label="Reading the hours">
        <h3 className="h3">Reading the hours</h3>
        <p className="small">Each day gives one median per hour. An hour needs {MIN_DAYS} days before it shows a number. Pick a longer period in the top bar for steadier hours, or Weekdays and Weekends to see whether they differ.</p>
        <p className="caption">What happened, not why or what to change.</p>
      </aside>
    </div>
  );
}
