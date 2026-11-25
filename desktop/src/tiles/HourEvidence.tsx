import { MIN_READINGS_PER_CELL_WEEK, MIN_WEEKS_PER_CELL } from '@/lib/metrics/dayHourGrid';
import { DATA, DAY, HEADS_UP, MEALS, SUGGESTIONS } from '../data/current';
import { hourName, rangeLabel } from '../data/derive';
import { openNextBuild } from '../data/intent';
import { eligibleForBuild } from '../data/suggestions';
import { useTracked } from '../data/tracked';
import type { FaceProps } from './faces';
import './hourEvidence.css';

type Grid = typeof DATA.WEEKDAY_GRID;
const ORDER = [1, 2, 3, 4, 5, 6, 0];
/**
 * The whole week at once, 7 rows by 24 hours (details pass, Nov 24): every hour of every weekday
 * is one press, so the shape of the week is visible before any single hour. Each cell is a button;
 * its mark (↓ often low, ↑ often high) and its label carry the reading, not colour alone (COL-5).
 */
function WeekStrip({ grid, weekday, hour, onPick }: { grid: Grid; weekday: number; hour: number; onPick: (wd: number, hr: number) => void }) {
  return (
    <div className="week-strip" role="grid" aria-label="Glucose by weekday and hour">
      <div className="ws-row ws-head" role="row" aria-hidden="true"><span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="ws-hr">{h % 6 === 0 ? hourName(h) : ''}</span>)}</div>
      {ORDER.map((wd) => (
        <div key={wd} className="ws-row" role="row">
          <span className="ws-day" role="rowheader">{grid.days[wd].label.slice(0, 3)}</span>
          {grid.days[wd].hours.map((c) => {
            const low = (c.lowPct ?? 0) >= 10, high = (c.highPct ?? 0) >= 25;
            const kind = c.medianMgdl == null ? 'none' : low ? 'low' : high ? 'high' : 'in';
            const on = wd === weekday && c.hour === hour;
            return (
              <button key={c.hour} type="button" role="gridcell" className={`ws-cell ${kind}${on ? ' on' : ''}`} aria-pressed={on}
                aria-label={`${grid.days[wd].label} ${rangeLabel(c.hour, c.hour + 1)}: ${c.medianMgdl == null ? 'not enough readings' : `median ${c.medianMgdl}, below ${grid.targetLowMgdl} ${c.lowPct ?? 0}%, above ${grid.targetHighMgdl} ${c.highPct ?? 0}%`}`}
                onClick={() => onPick(wd, c.hour)}>
                <span aria-hidden="true">{kind === 'low' ? '↓' : kind === 'high' ? '↑' : ''}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function HourEvidence({ route, go }: FaceProps) {
  const grid = DATA.WEEKDAY_GRID;
  const weekday = route.evidence?.weekday ?? HEADS_UP?.weekday ?? DAY.weekday;
  const hour = route.evidence?.hour ?? HEADS_UP?.stretch[0] ?? 12;
  const day = grid.days[weekday];
  const selected = day.hours[hour];
  const start = hour - hour % 4;
  const detail = route.tile === 'hour-evidence';
  const select = (wd: number, hr: number) => go({ evidence: { weekday: wd, hour: hr } }, { replace: true });
  const selection = { weekday, hour };
  const dates = selected.samples ?? [];
  const total = dates.reduce((sum, row) => sum + (row.count >= MIN_READINGS_PER_CELL_WEEK ? row.count : 0), 0);
  const source = DATA.source === 'synthetic' ? 'History' : 'Nightscout';
  const weekCount = (n: number) => n === 1 ? '1 week' : n + ' weeks';
  return (
    <section className={detail ? 'panel hour-evidence' : 'hour-evidence'} aria-label="Weekday glucose evidence">
      {detail ? (
        <>
          <p className="takeaway">{selected.medianMgdl == null ? `${day.label} ${rangeLabel(hour, hour + 1)}: not enough readings yet.` : `${day.label} ${rangeLabel(hour, hour + 1)}: median ${selected.medianMgdl} mg/dL, below ${grid.targetLowMgdl} in ${selected.lowPct ?? 0}% and above ${grid.targetHighMgdl} in ${selected.highPct ?? 0}% of readings, over ${weekCount(selected.weeksVoted)}.`}</p>
          <WeekStrip grid={grid} weekday={weekday} hour={hour} onPick={select} />
          <p className="caption">{source} · up to 12 weeks · ↓ ran below {grid.targetLowMgdl} in 10% or more of readings, ↑ above {grid.targetHighMgdl} in 25% or more · pick any hour</p>
        </>
      ) : (
        <>
          <div className="row between wrap"><p className="caption">{source} · Up to 12 weeks</p>
            <label className="caption">Hours <select value={start} onChange={e => select(weekday, Number(e.target.value))}>
              {[0, 4, 8, 12, 16, 20].map(h => <option key={h} value={h}>{rangeLabel(h, h + 4)}</option>)}
            </select></label></div>
          <div className="hour-days" role="group" aria-label="Weekday">
            {[1, 2, 3, 4, 5, 6, 0].map(i => <button type="button" key={i} aria-label={grid.days[i].label} aria-pressed={weekday === i} onClick={() => select(i, hour)}>{grid.days[i].label.slice(0, 3)}</button>)}
          </div>
        </>
      )}
      <table className="hour-table"><caption>{day.label} · glucose in mg/dL</caption>
        <thead><tr><th scope="col">Hour</th><th scope="col">Median</th><th scope="col">Below {grid.targetLowMgdl}</th><th scope="col">Above {grid.targetHighMgdl}</th><th scope="col">Weeks</th></tr></thead>
        <tbody>{day.hours.slice(start, start + 4).map(cell => <tr key={cell.hour} className={cell.hour === hour ? 'selected-hour' : ''}>
          <th scope="row"><button type="button" aria-pressed={cell.hour === hour} onClick={() => select(weekday, cell.hour)}>{rangeLabel(cell.hour, cell.hour + 1)}</button></th>
          <td>{cell.medianMgdl ?? '—'}</td><td>{cell.lowPct == null ? '—' : cell.lowPct + '%'}</td><td>{cell.highPct == null ? '—' : cell.highPct + '%'}</td><td>{cell.weeksVoted}</td>
        </tr>)}</tbody>
      </table>
      <div className="hour-selection" aria-live="polite">
        <strong>{day.label} · {rangeLabel(hour, hour + 1)}</strong>
        <span className="small">{selected.reliable ? total + ' readings across ' + weekCount(selected.weeksVoted) : dates.length ? 'Limited coverage · ' + weekCount(selected.weeksVoted) + ' met the sample minimum' : 'No readings recorded for this hour'}</span>
      </div>
      <div className="row wrap">
        {!detail && <button type="button" className="text-btn" onClick={() => go({ tile: 'hour-evidence', evidence: selection })}>Inspect dates</button>}
        {dates.length > 0 && <button type="button" className="quiet-btn" onClick={() => go({ view: 'assistant', evidence: selection })}>Ask about this hour</button>}
      </div>
      {detail && <div className="stack-8 hour-samples"><h3 className="h3">Dates behind this hour</h3>
        <p className="small">Each date needs {MIN_READINGS_PER_CELL_WEEK} readings to count. Percentages pool readings from counted dates. The median uses each date once. Totals appear after {MIN_WEEKS_PER_CELL} counted weeks.</p>
        {dates.length > 0 && <table className="hour-table"><caption>{day.label} · {rangeLabel(hour, hour + 1)} · {source}</caption><thead><tr><th scope="col">Date</th><th scope="col">Readings</th><th scope="col">Below {grid.targetLowMgdl}</th><th scope="col">Above {grid.targetHighMgdl}</th><th scope="col">Coverage</th></tr></thead>
          <tbody>{dates.map(row => <tr key={row.firstIso}><th scope="row">{new Date(row.firstIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</th><td>{row.count}</td><td>{row.below}</td><td>{row.above}</td><td>{row.count >= MIN_READINGS_PER_CELL_WEEK ? 'Counted' : 'Partial'}</td></tr>)}</tbody></table>}
      </div>}
    </section>
  );
}

export function ReviewQueue({ go, route }: FaceProps) {
  const { all } = useTracked();
  const observed = SUGGESTIONS.filter(s => s.confidence !== 'unusable' && all[s.id]?.state !== 'dismissed' && all[s.id]?.state !== 'staged').length;
  const drafts = SUGGESTIONS.filter(s => all[s.id]?.state === 'staged' && eligibleForBuild(s).ok).length;
  const foods = MEALS.groups.filter(g => g.n >= 2).length;
  return <section className={(route.tile === 'review-queue' ? 'panel ' : '') + 'focus-queue'} aria-label="Review destinations">
    {DATA.source !== 'synthetic' && <p className="caption">Your profile</p>}
    <div><h3 className="h3">Observations</h3><p className="small">{observed} available to review</p><button type="button" className="text-btn" onClick={() => go({ view: 'suggestions' })}>Review suggestions</button></div>
    <div><h3 className="h3">Favorite meals</h3><p className="small">{foods} {foods === 1 ? 'food has' : 'foods have'} repeat entries</p><button type="button" className="text-btn" onClick={() => go({ tile: 'meals' })}>Compare meals</button></div>
    <div><h3 className="h3">Next build</h3><p className="small">{drafts} staged {drafts === 1 ? 'draft' : 'drafts'} awaiting review</p><button type="button" className="text-btn" onClick={() => { openNextBuild(); go({ view: 'assistant' }); }}>Open next build</button></div>
  </section>;
}
