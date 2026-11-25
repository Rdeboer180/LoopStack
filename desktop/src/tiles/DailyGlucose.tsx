// Daily glucose: the average for each day of the period and today so far,
// with each day's spread. Different from the day tracker, which is one
// weekday hour by hour: this is day after day. Observations only (SAFE-1).
import { useState } from 'react';
import { DailyChart } from '../charts/DailyChart';
import { DAILY, NOT_COUNTED, NOT_COUNTED_CAUSE, PERIOD, READ } from '../data/current';
import { DayRings, ringTakeaway } from '../ui/DayRings';
import { Fit } from '../ui/kit';
import type { FaceProps } from './faces';
import './daily.css';
import { BANDS, rangeText } from '../data/ranges';

function summary() {
  const counted = DAILY.days.filter((d) => d.usable && d.meanMgdl != null);
  const mean = counted.length ? Math.round(counted.reduce((t, d) => t + (d.meanMgdl ?? 0), 0) / counted.length) : null;
  const hi = counted.reduce<(typeof counted)[number] | null>((b, d) => (!b || d.meanMgdl! > b.meanMgdl! ? d : b), null);
  const lo = counted.reduce<(typeof counted)[number] | null>((b, d) => (!b || d.meanMgdl! < b.meanMgdl! ? d : b), null);
  return { counted, mean, hi, lo };
}

function Legend() {
  return <span className="caption">Dot: the day’s average · bar: its middle half · line: 5–95% · dashed: {PERIOD.days}-day average · {rangeText()} mg/dL shaded</span>;
}

export function DailyGlucoseGlance({ h }: FaceProps) {
  const { counted, mean } = summary();
  const t = DAILY.today;
  return (
    <div className="face">
      <div className="daily-now">
        {t && <span><span className="num">{t.meanMgdl}</span> <span className="small">mg/dL today so far</span></span>}
        {mean != null && <span className="small">{PERIOD.days}-day average <b className="strong">{mean} mg/dL</b> · {counted.length} of {DAILY.days.length} days counted</span>}
      </div>
      <Fit className="grow" minH={80}>{({ w, h: hh }) => <DailyChart days={DAILY.days} today={t} W={w} H={hh} />}</Fit>
      {h > 2 && <Legend />}
      {h > 3 && <DayRings days={DAILY.days.slice(-5)} today={t} size={32} />}
    </div>
  );
}

export function DailyGlucoseDetail() {
  const { counted, mean, hi, lo } = summary();
  const rows = DAILY.today ? [...DAILY.days, DAILY.today] : [...DAILY.days];
  const [sel, setSel] = useState<number | null>(null);
  // A long period keeps the table to its last 4 weeks until asked: 180 rows is a wall, not a read.
  const [allRows, setAllRows] = useState(false);
  const SHOWN = 28;
  const firstShown = allRows || rows.length <= SHOWN + 7 ? 0 : rows.length - SHOWN;
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Daily glucose chart">
        <div className="row wrap">
          <span className="sample">{PERIOD.label} · {counted.length} of {DAILY.days.length} days counted</span>
          {DAILY.today && <span className="caption">Today so far: {DAILY.today.readings} readings</span>}
        </div>
        <p className="takeaway">{ringTakeaway(DAILY.days, READ.mine.inRangePct)}</p>
        <Fit className="chart-lg">{({ w, h }) => <DailyChart days={DAILY.days} today={DAILY.today} W={w} H={h} values sel={sel} />}</Fit>
        <Legend />
        <p className="caption">In range is {rangeText()} mg/dL, your band. The rings by day live in Time in range; the table below has every day.</p>
        <table className="daily-table">
          <caption className="sr-only">Glucose for each day: average, middle half, time in range, below and above your band, and readings</caption>
          <thead>
            <tr><th scope="col">Day</th><th scope="col">Average</th><th scope="col">Middle half</th><th scope="col">In range</th><th scope="col">Below {BANDS.low}</th><th scope="col">Above {BANDS.high}</th><th scope="col">Readings</th></tr>
          </thead>
          <tbody>
            {rows.map((d, i) => {
              if (i < firstShown) return null;
              const isToday = DAILY.today != null && i === rows.length - 1;
              const missing = d.meanMgdl == null || (!d.usable && !isToday);
              return (
                <tr key={`${d.day}-${i}`} aria-selected={sel === i || undefined} onMouseEnter={() => setSel(i)} onMouseLeave={() => setSel(null)}>
                  <th scope="row">{d.label}{isToday ? ', so far' : ''}</th>
                  {missing ? (
                    <td colSpan={6} className="muted">Not counted{d.day === NOT_COUNTED && NOT_COUNTED_CAUSE ? `: ${NOT_COUNTED_CAUSE.toLowerCase()}` : ''} · {d.readings} readings</td>
                  ) : (
                    <>
                      <td>{d.meanMgdl} mg/dL</td>
                      <td>{d.p25}–{d.p75}</td>
                      <td>{d.inRangePct}%</td>
                      <td>{d.belowPct}%</td>
                      <td>{d.abovePct}%</td>
                      <td>{d.readings}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > SHOWN + 7 && (
          <button type="button" className="text-btn" aria-expanded={allRows} onClick={() => setAllRows((v) => !v)}>
            {allRows ? `Show the last ${SHOWN} days` : `Show all ${rows.length} days`}
          </button>
        )}
      </section>
      <aside className="panel stack-12" aria-label="About daily glucose">
        <h3 className="h3">Day after day</h3>
        {mean != null && hi && lo ? (
          <p className="small">Across {counted.length} counted days the average was {mean} mg/dL. The highest daily average was {hi.meanMgdl} mg/dL on {hi.label}; the lowest, {lo.meanMgdl} mg/dL on {lo.label}.</p>
        ) : <p className="small">Not enough readings yet to compare days.</p>}
        <p className="small">The day tracker shows one weekday hour by hour. This shows each day as a whole, in order, so a run of higher or lower days stands out.</p>
        <p className="caption">What happened, not why. A day needs at least 2 hours of readings to show numbers.</p>
      </aside>
    </div>
  );
}
