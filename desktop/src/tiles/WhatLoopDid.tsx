// What Loop did, as patterns in plain words (design B, refined in a data-
// presentation pass). Leads with the daily basal balance, then the times of
// day when Loop's delivery kept differing from the scheduled basal, each one
// expandable into a per-day breakdown. "See every hour" opens the full table
// (VIS-8). Loop's words: temp basal, automatic bolus, 0 U/hr. Observations
// only: what Loop did, never what to change (SAFE-1).
import { useMemo, useState } from 'react';
import { PERIOD, RUN_TIME } from '../data/current';
import { hourName, rangeLabel } from '../data/derive';
import { balance, findPatterns, hourRows, type Balance, type HourRow, type Pattern } from '../data/patterns';
import { loopPatternInputs } from '../data/loopPatterns';
import type { FaceProps } from './faces';
import './whatloopdid.css';
import { BANDS } from '../data/ranges';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORANGE = 'var(--graph-insulin)';

function useModel() {
  return useMemo(() => {
    const inp = loopPatternInputs();
    const patterns = findPatterns(inp);
    const rows = hourRows(inp);
    return { bal: balance(inp), patterns, rows, other: rows.filter((r) => !patterns.some((p) => r.hour >= p.start && r.hour < p.end)).length };
  }, []);
}

const u = (v: number, d = 1) => `${Math.abs(v).toFixed(d)} U`;
const uph = (v: number) => `${Math.abs(v).toFixed(2)} U/hr`;
const when = (p: Pattern) => `${p.weekday != null ? `${WD_LONG[p.weekday]}s` : p.start >= 4 && p.start < 12 ? 'Mornings' : p.start >= 12 && p.start < 17 ? 'Afternoons' : p.start >= 17 && p.start < 22 ? 'Evenings' : 'Nights'}, ${rangeLabel(p.start, p.end)}`;
const kindTitle = (p: Pattern) => (p.kind === 'below' ? 'temp basals below scheduled' : p.kind === 'above' ? 'temp basals above scheduled' : '0 U/hr temp basals');
const unitWord = (p: Pattern) => (p.weekday != null ? `${WD_LONG[p.weekday]}s` : p.start >= 4 && p.start < 12 ? 'mornings' : p.start >= 17 && p.start < 22 ? 'evenings' : 'days');
const arrow = { falling: '↘', steady: '→', rising: '↗' } as const;

function whatLine(p: Pattern): string {
  if (p.kind === 'zero') return `0 U/hr for at least half of ${rangeLabel(p.start, p.end)} on ${p.seen} of ${p.of} ${unitWord(p)}.`;
  const dir = p.kind === 'below' ? 'below' : 'above';
  const [lo, hi] = [Math.abs(p.netRange[0]), Math.abs(p.netRange[1])].sort((x, y) => x - y);
  const range = lo !== hi ? ` (${lo.toFixed(2)}–${hi.toFixed(2)} U/hr)` : '';
  return `Median ${uph(p.netUph)} ${dir} scheduled${range} on ${p.seen} of ${p.of} ${unitWord(p)}: ${u(p.unitsEach)} ${p.kind === 'below' ? 'less' : 'more'} over the ${p.end - p.start} hours.`;
}
function overrideLine(p: Pattern): string | null {
  if (!p.override) return null;
  return `An override was on for most of these hours on ${p.override.days} of ${p.seen}: ${p.override.name}. Its insulin needs are in the schedule above; its correction range is not.`;
}
function autoLine(p: Pattern): string | null {
  return p.autoBolusEach >= 0.05 ? `Loop also gave a median ${u(p.autoBolusEach)} in automatic boluses over these hours.` : null;
}
function glucoseLine(p: Pattern): string {
  if (p.glucoseMedian == null) return '';
  const t = (Object.entries(p.trends) as [keyof typeof arrow, number][]).sort((a, b) => b[1] - a[1])[0];
  const trend = t && t[1] > 0 ? `, ${t[0]} ${arrow[t[0]]} on ${t[1]} of ${p.seen}` : '';
  return `Glucose at ${hourName(p.start)}: median ${Math.round(p.glucoseMedian)} mg/dL${trend}.`;
}
function workoutLine(p: Pattern): string | null {
  if (!p.workouts || !RUN_TIME) return null;
  return `A workout was logged ${RUN_TIME.label.startsWith('around') ? RUN_TIME.label : `at ${RUN_TIME.label}`} on ${p.workouts === p.seen ? (p.seen === 2 ? 'both' : `all ${p.seen}`) : `${p.workouts} of ${p.seen}`} of those days.`;
}

// ------------------------------------------------------------ the day, hour by hour: one strip for every pattern
// Bars sit on a baseline that is the scheduled basal: up is more than
// scheduled, down is less, height is the median difference that hour. Hours
// inside an established pattern are orange and bracketed with words, so the
// pattern reads by position and text, not colour alone. The SVG stretches with
// the tile; every label is HTML, so type stays at its set size.

const pct = (h: number) => `${(h / 24) * 100}%`;
const often = (p: Pattern) => (p.seen / p.of >= 0.75 ? 'most' : p.seen / p.of >= 0.45 ? 'about half the' : 'some');
const dayWord = (p: Pattern) => (p.weekday != null ? `${WD_LONG[p.weekday]}s` : unitWord(p));

function headline(est: Pattern[]): string {
  if (!est.length) return 'Loop kept close to your scheduled basal: no time of day stood out.';
  const part = (p: Pattern, first: boolean) => {
    const where = `on ${often(p)} ${dayWord(p)}, ${rangeLabel(p.start, p.end)}`;
    if (p.kind === 'zero') return `${first ? 'held 0 U/hr temp basals' : 'held 0 U/hr'} ${where}`;
    return `${first ? `ran ${p.kind} your scheduled basal` : `${p.kind} it`} ${where}`;
  };
  const [a, b] = est;
  return `Loop ${part(a, true)}${b ? `, and ${part(b, false)}` : ''}.`;
}

function DayStrip({ rows, marked, numbered = false, tall = false }: { rows: HourRow[]; marked: Pattern[]; numbered?: boolean; tall?: boolean }) {
  const peak = Math.max(0.2, ...rows.map((r) => Math.abs(r.net ?? 0)));
  const max = Math.ceil(peak * 10) / 10;
  const H = 40;
  const inMarked = (h: number) => marked.find((p) => h >= p.start && h < p.end);
  const label = `Each hour, median difference between Loop's delivery and your scheduled basal, up to ±${max.toFixed(1)} U/hr. `
    + (marked.length ? marked.map((p, i) => `${numbered ? `${i + 1}: ` : ''}${rangeLabel(p.start, p.end)}, ${p.kind === 'zero' ? '0 U/hr' : `${p.kind} scheduled, ${p.netUph < 0 ? 'minus' : 'plus'} ${uph(p.netUph)}`}, ${p.seen} of ${p.of} ${dayWord(p)}.`).join(' ') : 'Every hour within 15% of scheduled.');
  return (
    <figure className={`wld-day${tall ? ' tall' : ''}`} role="img" aria-label={label}>
      <div className="wld-day-brackets" aria-hidden="true">
        {marked.map((p, i) => (
          <span key={`${p.kind}-${p.start}`} className="wld-bracket" style={{ left: pct(p.start), width: pct(p.end - p.start) }}>
            <span className="wld-bracket-text">{numbered && <b>{i + 1}</b>}{rangeLabel(p.start, p.end)} · {p.seen} of {p.of}</span>
          </span>
        ))}
      </div>
      <div className="wld-day-plot" aria-hidden="true">
        <span className="wld-day-dir up">more</span>
        <span className="wld-day-dir down">less</span>
        <svg viewBox={`0 0 240 ${H * 2}`} preserveAspectRatio="none">
          {[6, 12, 18].map((h) => <line key={h} x1={h * 10} x2={h * 10} y1="0" y2={H * 2} stroke="var(--ink-200)" vectorEffect="non-scaling-stroke" />)}
          {rows.map((r) => {
            const p = inMarked(r.hour);
            const n = p?.kind === 'zero' ? -r.scheduled : r.net ?? 0;
            const h = Math.max(1.2, (Math.min(Math.abs(n), max) / max) * (H - 2));
            return <rect key={r.hour} x={r.hour * 10 + 1.5} width="7" y={n >= 0 ? H - h : H} height={h} fill={p ? ORANGE : 'var(--ink-300)'} />;
          })}
          <line x1="0" x2="240" y1={H} y2={H} stroke="var(--ink-900)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="wld-day-base">scheduled</span>
      </div>
      <div className="wld-day-axis caption" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: pct(h) }}>{hourName(h % 24)}</span>)}
      </div>
    </figure>
  );
}

// ------------------------------------------------------------ a pattern's 24-hour net strip and its days

function NetStrip({ p, rows }: { p: Pattern; rows: HourRow[] }) {
  const W = 288;
  const cw = W / 24;
  const max = 0.8;
  const y0 = 44;
  return (
    <svg viewBox={`0 0 ${W} 88`} role="img" aria-label={`Net basal by hour, median of all counted days, ±${max} U/hr; ${rangeLabel(p.start, p.end)} bracketed.`} className="wld-strip">
      <line x1="0" x2={W} y1={y0} y2={y0} stroke="var(--ink-300)" />
      {rows.map((r) => {
        const n = p.kind === 'zero' ? (r.hour >= p.start && r.hour < p.end ? -r.scheduled : r.net ?? 0) : r.net ?? 0;
        const h = Math.max(1.5, Math.min(24, (Math.abs(n) / max) * 24));
        const on = r.hour >= p.start && r.hour < p.end;
        return <rect key={r.hour} x={r.hour * cw + 1} y={n >= 0 ? y0 - h : y0} width={cw - 2} height={h} rx="1" fill={on ? ORANGE : 'var(--ink-300)'} />;
      })}
      <path d={`M${p.start * cw} 18V14H${p.end * cw}V18`} fill="none" stroke="var(--ink-900)" strokeWidth="1.2" />
      <text x={Math.min(W - 20, Math.max(20, ((p.start + p.end) / 2) * cw))} y="10" fontSize="10" textAnchor="middle" fontWeight="600" fill="var(--ink-900)">{rangeLabel(p.start, p.end)}</text>
      <text x="0" y="84" fontSize="10" fill="var(--ink-700)">12a</text>
      <text x={W / 2} y="84" fontSize="10" textAnchor="middle" fill="var(--ink-700)">12p</text>
      <text x={W} y="84" fontSize="10" textAnchor="end" fill="var(--ink-700)">12a · ±{max} U/hr</text>
    </svg>
  );
}

function DayDots({ p }: { p: Pattern }) {
  const shown = p.days.filter((d) => p.weekday == null || WD.indexOf(d.day.split(' ')[0]) === p.weekday);
  return (
    <div className="wld-dots">
      <span className="caption">{shown[0]?.day}</span>
      <ul aria-label={`${p.seen} of ${p.of} ${unitWord(p)} showed it`}>
        {shown.map((d) => <li key={d.day} className={`dot ${d.status}`} title={`${d.day}: ${d.status === 'seen' ? 'showed it' : d.status === 'not' ? 'did not' : 'no data'}`} />)}
      </ul>
      <span className="caption">{shown[shown.length - 1]?.day}</span>
    </div>
  );
}

function DotKey() {
  return (
    <div className="wld-key caption">
      <span><i className="dot seen" />showed it</span><span><i className="dot not" />didn’t</span><span><i className="dot nodata" />no data</span>
    </div>
  );
}

// ------------------------------------------------------------ expanded: the window, then each day

function WindowChart({ p }: { p: Pattern }) {
  const W = 560;
  const n = p.window.length;
  const cw = W / n;
  const x = (i: number) => 40 + i * ((W - 50) / n);
  const step = (W - 50) / n;
  const gy = (g: number) => 10 + ((260 - Math.min(260, Math.max(40, g))) / 220) * 90;
  const uy = (v: number) => 210 - (v / 1.6) * 70;
  const gl = p.window.map((w, i) => (w.glucose == null ? '' : `${i ? 'L' : 'M'}${(x(i) + step / 2).toFixed(1)} ${gy(w.glucose).toFixed(1)}`)).join('');
  const band = p.window.every((w) => w.g25 != null && w.g75 != null)
    ? `M${p.window.map((w, i) => `${(x(i) + step / 2).toFixed(1)} ${gy(w.g75!).toFixed(1)}`).join('L')}L${[...p.window].reverse().map((w, i) => `${(x(n - 1 - i) + step / 2).toFixed(1)} ${gy(w.g25!).toFixed(1)}`).join('L')}Z`
    : '';
  const sched = p.window.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${uy(w.scheduled).toFixed(1)}L${(x(i) + step).toFixed(1)} ${uy(w.scheduled).toFixed(1)}`).join('');
  const deliv = p.window.map((w, i) => (w.delivered == null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${uy(w.delivered).toFixed(1)}L${(x(i) + step).toFixed(1)} ${uy(w.delivered).toFixed(1)}`)).join('');
  const si = p.window.findIndex((w) => w.hour === p.start);
  const ei = p.window.findIndex((w) => w.hour === p.end - 1);
  void cw;
  return (
    <svg viewBox={`0 0 ${W} 236`} role="img" aria-label={`${rangeLabel(p.window[0].hour, p.window[n - 1].hour + 1)}, median of the ${p.seen} days that showed it: glucose above, scheduled basal dotted and delivered solid below.`} className="wld-window">
      <rect x={x(si)} y="4" width={(ei - si + 1) * step} height="216" fill="var(--accent-info-soft)" />
      <rect x="40" y={gy(BANDS.high)} width={W - 50} height={gy(BANDS.low) - gy(BANDS.high)} fill="var(--range-in-soft)" />
      <text x="34" y={gy(BANDS.high) + 4} fontSize="10" textAnchor="end" fill="var(--ink-700)">{BANDS.high}</text>
      <text x="34" y={gy(BANDS.low) + 4} fontSize="10" textAnchor="end" fill="var(--ink-700)">{BANDS.low}</text>
      {band && <path d={band} fill="var(--ink-900)" fillOpacity="0.08" />}
      <path d={gl} fill="none" stroke="var(--ink-900)" strokeWidth="2" />
      <text x="40" y="128" fontSize="10" fontWeight="600" fill="var(--ink-700)">BASAL · U/hr</text>
      <line x1="40" x2={W - 10} y1="210" y2="210" stroke="var(--ink-200)" />
      <path d={deliv} fill="none" stroke={ORANGE} strokeWidth="2.2" />
      <path d={sched} fill="none" stroke="var(--ink-900)" strokeWidth="1.4" strokeDasharray="2 3" />
      {p.window.map((w, i) => <text key={w.hour} x={x(i) + step / 2} y="230" fontSize="10" textAnchor="middle" fill="var(--ink-700)">{hourName(w.hour)}</text>)}
    </svg>
  );
}

function DayRow({ d, p }: { d: Pattern['days'][number]; p: Pattern }) {
  if (d.status === 'nodata') {
    return <tr className="nodata"><th scope="row">{d.day}</th><td colSpan={5}>No data in {rangeLabel(p.start, p.end)}</td></tr>;
  }
  const W = 80;
  const cw = W / d.hours.length;
  const uy = (v: number) => 20 - (v / 1.6) * 18;
  return (
    <tr className={d.status}>
      <th scope="row">{d.day}{d.workout ? <span className="caption"> · workout</span> : null}</th>
      <td>{d.status === 'seen' ? 'Showed it' : 'Didn’t'}</td>
      <td>
        <svg viewBox={`0 0 ${W} 22`} width={W} height="22" aria-hidden="true">
          {d.hours.map((h, i) => (
            <g key={h.hour}>
              <rect x={i * cw + 1} y={uy(h.delivered)} width={cw - 2} height={20 - uy(h.delivered)} fill={ORANGE} fillOpacity="0.7" />
              <line x1={i * cw} x2={(i + 1) * cw} y1={uy(h.scheduled)} y2={uy(h.scheduled)} stroke="var(--ink-900)" strokeDasharray="2 2" />
            </g>
          ))}
        </svg>
      </td>
      <td>{d.netU < 0 ? '−' : '+'}{u(d.netU, 2)}</td>
      <td>{d.glucoseStart ?? '—'}{d.trend ? ` ${arrow[d.trend]}` : ''}</td>
      <td>{d.low != null && d.high != null ? `${d.low}–${d.high}` : '—'}</td>
    </tr>
  );
}

function PatternCard({ p, rows, rank }: { p: Pattern; rows: HourRow[]; rank: number | null }) {
  const [open, setOpen] = useState(false);
  const id = `wld-${p.kind}-${p.start}`;
  const work = workoutLine(p);
  return (
    <article className={`wld-card${p.established ? '' : ' tentative'}`} aria-labelledby={`${id}-h`}>
      <div className="wld-card-main">
        <div className="wld-card-text">
          {rank != null && <span className="wld-rank" aria-hidden="true">{rank}</span>}
          <div className="stack-4">
            <h3 id={`${id}-h`} className="wld-title">{when(p)} · {kindTitle(p)}</h3>
            <p className="wld-what">{whatLine(p)}</p>
            {glucoseLine(p) && <p className="small">{glucoseLine(p)}</p>}
            {autoLine(p) && <p className="small">{autoLine(p)}</p>}
            {overrideLine(p) && <p className="small ink">{overrideLine(p)}</p>}
            {work && <p className="small">{work}</p>}
            {!p.established && <p className="small ink">Seen on {p.seen === 2 && p.of === 2 ? 'both' : `${p.seen} of ${p.of}`} {unitWord(p)} · not enough yet to call it a pattern.</p>}
          </div>
        </div>
        <div className="wld-card-viz">
          <NetStrip p={p} rows={rows} />
          <DayDots p={p} />
        </div>
      </div>
      <button type="button" className="text-btn wld-expand" aria-expanded={open} aria-controls={`${id}-more`} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the days' : `See the ${p.weekday != null ? WD_LONG[p.weekday] + 's' : 'days'}, one by one`}
      </button>
      {open && (
        <div id={`${id}-more`} className="wld-more">
          <WindowChart p={p} />
          <table className="wld-days">
            <caption className="sr-only">{when(p)}, each day</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">{rangeLabel(p.start, p.end)}</th><th scope="col">Delivered against scheduled</th><th scope="col">Net</th><th scope="col">Glucose at {hourName(p.start)}</th><th scope="col">Low–high</th></tr></thead>
            <tbody>{p.days.filter((d) => p.weekday == null || WD.indexOf(d.day.split(' ')[0]) === p.weekday).map((d) => <DayRow key={d.day} d={d} p={p} />)}</tbody>
          </table>
          <p className="caption">A day shows it when its net over {rangeLabel(p.start, p.end)} is beyond 15% of scheduled (at least 0.05 U/hr) in the same direction. Median across the {p.seen} days that showed it: {uph(p.netUph)}.</p>
        </div>
      )}
    </article>
  );
}

function EveryHour({ rows }: { rows: HourRow[] }) {
  return (
    <table className="wld-hours">
      <caption className="sr-only">Every hour: scheduled and median delivered basal, and how many days were above, below, about as scheduled, at 0 U/hr, or missing</caption>
      <thead><tr><th scope="col">Hour</th><th scope="col">Scheduled</th><th scope="col">Delivered, median</th><th scope="col">Net</th><th scope="col">Above</th><th scope="col">Below</th><th scope="col">About</th><th scope="col">0 U/hr</th><th scope="col">No data</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.hour}>
            <th scope="row">{hourName(r.hour)}</th>
            <td>{r.scheduled.toFixed(2)}</td>
            <td>{r.delivered == null ? '—' : r.delivered.toFixed(2)}</td>
            <td>{r.net == null ? '—' : `${r.net < 0 ? '−' : '+'}${Math.abs(r.net).toFixed(2)}`}</td>
            <td>{r.above}</td><td>{r.below}</td><td>{r.about}</td><td>{r.zero}</td><td>{r.nodata}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------ faces

function totalsLine(b: Balance) {
  return `Mean per day over ${b.days} days: ${u(b.delivered)} delivered of ${u(b.scheduled)} scheduled (${u(b.net)} ${b.net < 0 ? 'less' : 'more'}).`;
}
const listRate = (p: Pattern) => (p.kind === 'zero' ? '0 U/hr' : `${p.netUph < 0 ? '−' : '+'}${uph(p.netUph)}`);
const listKind = (p: Pattern) => (p.kind === 'zero' ? '0 U/hr temp basals' : `${p.kind} scheduled`);

export function WhatLoopDidGlance({ h }: FaceProps) {
  const { bal, patterns, rows } = useModel();
  const est = patterns.filter((p) => p.established);
  const tent = patterns.filter((p) => !p.established);
  const marked = est.slice(0, h >= 3 ? 3 : 2);
  return (
    <div className="face wld-glance">
      <div className="stack-4">
        <p className="lead-sm">{headline(est)}</p>
        <p className="caption">{totalsLine(bal)}</p>
      </div>
      <DayStrip rows={rows} marked={marked} />
      {h >= 3 && marked.length > 0 && (
        <ul className="wld-glance-list">
          {marked.map((p) => (
            <li key={`${p.kind}-${p.start}`}>
              <span className="strong">{when(p)}</span>
              <span className="small">{listKind(p)} · {p.seen} of {p.of} {dayWord(p)} · {listRate(p)}</span>
            </li>
          ))}
        </ul>
      )}
      {h >= 3 && tent[0] && <p className="caption">Not enough yet: {when(tent[0])}, {tent[0].kind === 'zero' ? '0 U/hr' : listKind(tent[0])} on {tent[0].seen} of {tent[0].of}.</p>}
    </div>
  );
}

export function WhatLoopDidDetail() {
  const { bal, patterns, rows, other } = useModel();
  const [every, setEvery] = useState(false);
  const est = patterns.filter((p) => p.established);
  const tent = patterns.filter((p) => !p.established);
  return (
    <div className="wld">
      <section className="panel wld-balance" aria-labelledby="wld-bal">
        <div className="stack-4">
          <h2 id="wld-bal" className="label">Your day, against your scheduled basal</h2>
          <p className="wld-big">{headline(est)}</p>
          <p className="small">{totalsLine(bal)} Hours more than 15% off account for {u(bal.below)} below and {u(bal.above)} above; smaller differences make up the rest.</p>
          {bal.autoBolus >= 0.05 && <p className="small">Loop also gave {u(bal.autoBolus)} a day in automatic boluses, on top of basal.</p>}
        </div>
        <DayStrip rows={rows} marked={est} numbered tall />
        <p className="caption">{PERIOD.label} · {bal.days} days with Loop data · temp basals against your scheduled basal (scaled by an override’s insulin needs while one runs); automatic boluses counted separately</p>
      </section>

      <section className="stack-12" aria-labelledby="wld-pat">
        <div className="row between wrap">
          <h2 id="wld-pat" className="label">When Loop’s delivery differed from your scheduled basal</h2>
          <DotKey />
        </div>
        <p className="caption">Most consistent first. A time of day shows here when it happened on at least 5 days, or 3 of the same weekday.</p>
        {est.map((p, i) => <PatternCard key={`${p.kind}-${p.start}`} p={p} rows={rows} rank={i + 1} />)}
        {!est.length && <p className="small">No time of day stood out.</p>}
        {tent.length > 0 && (
          <>
            <h3 className="label">Not enough yet</h3>
            {tent.map((p) => <PatternCard key={`${p.kind}-${p.start}`} p={p} rows={rows} rank={null} />)}
          </>
        )}
        <p className="small">In the other {other} hours, delivery was within 15% of scheduled on most days.</p>
      </section>

      <section className="stack-12" aria-labelledby="wld-every">
        <button type="button" id="wld-every" className="quiet-btn" aria-expanded={every} aria-controls="wld-every-table" onClick={() => setEvery((e) => !e)}>{every ? 'Hide every hour' : 'See every hour'}</button>
        {every && <div id="wld-every-table" className="panel wld-every"><EveryHour rows={rows} /></div>}
      </section>
      <p className="caption">What Loop did, not what to change.</p>
    </div>
  );
}
