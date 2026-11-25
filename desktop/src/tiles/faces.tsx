// Every tracker has two faces (VIS-9): a glance face that fits its tile, and a
// detail face one click in. Patient-side copy uses community words (DM-9) and
// says what Loop or glucose did, never what to do (SAFE-1).
import { useState, type ReactNode } from 'react';
import { bands, TirBar } from '../charts/Agp';
import { DayTrackerChart } from '../charts/DayTracker';
import { GlucoseChart } from '../charts/GlucoseChart';
import { CgmChart } from '../charts/CgmChart';
import { gridGeom, HourGrid } from '../charts/HourGrid';
import { MorningsChart } from '../charts/MorningsChart';
import {
  blocks, count, diff, hourName, morningGlucose, partOfDay, peak, pct, rangeLabel, select, stretchOf, USABLE_N, type Mode,
} from '../data/derive';
import {
  CGM_NOW, CHANGES, DAILY, DATA, DAY, DAY_BY_WEEKDAY, HEADS_UP, LUNCH, NOT_COUNTED, NOT_COUNTED_CAUSE, PATIENT, PERIOD, READ, TEXT,
} from '../data/current';
import { daysLeft, useLoopBuild } from '../data/loopBuild';
import { FavoriteFoodsDetail, FavoriteFoodsGlance } from './FavoriteFoods';
import { DailyGlucoseDetail, DailyGlucoseGlance } from './DailyGlucose';
import { CareThreadDetail, CareThreadGlance } from './CareTeam';
import { WhatLoopDidDetail as WhatLoopDidPatternsDetail, WhatLoopDidGlance as WhatLoopDidPatternsGlance } from './WhatLoopDid';
import { HourEvidence, ReviewQueue } from './HourEvidence';
import type { Go, Route } from '../nav';
import { TILES, type TileKind } from '../layout/model';
import { useStore, who, type Msg } from '../state';
import { HourByHourDetail, HourByHourGlance } from './HourByHour';
import { DayRings, ringKey, weakestDay } from '../ui/DayRings';
import { BANDS, isStandard, rangeText } from '../data/ranges';
import { nowStatus } from '../data/glucoseNow';
import { DeltaChip } from '../ui/DeltaChip';
import { DayPicker, dayPickIndex, dayPickName, dayPickOf, downloadCsv, FocusBar, inPick, type DayPick, type FocusView } from '../ui/Focus';
import { Chip, Fit, IBell, LoopPill, Num, Ring, Segmented, useAnnounce } from '../ui/kit';

export interface FaceProps {
  route: Route;
  go: Go;
  /** Tile size in grid units, for glance faces that change with size. */
  w: number;
  h: number;
}

// ------------------------------------------------------------ glucose now

function CgmNumber({ big = false }: { big?: boolean }) {
  const c = CGM_NOW;
  return (
    <div className={`cgm-value${big ? ' big' : ''}`}>
      <span className="num">{c.mgdl ?? '—'}</span>
      <span className="unit">mg/dL</span>
      <span className="arrow" role="img" aria-label={c.trendLabel}>{c.trend}</span>
      <span className="caption age">{c.ageMin} min ago</span>
      <NowStatusLine />
    </div>
  );
}

/** The phone's status line: in range, low or urgent low from your bands, and the trend in words. */
function NowStatusLine() {
  const s = nowStatus(CGM_NOW.mgdl, CGM_NOW.points);
  if (!s) return null;
  return <span className={`cgm-status ${s.tone}`}>{s.word} · {s.trend.toLowerCase()}</span>;
}

function LoopLine() {
  const c = CGM_NOW;
  return (
    <div className="row wrap small" style={{ gap: 14 }}>
      <span className="status-line"><Ring minutes={PATIENT.loopedMinAgo} /> Looped {PATIENT.loopedMinAgo} min ago</span>
      <span><b className="strong">{c.activeInsulinU == null ? '—' : c.activeInsulinU.toFixed(2)} U</b> active insulin</span>
      <span><b className="strong">{c.activeCarbsG ?? '—'} g</b> active carbs</span>
    </div>
  );
}

function GlucoseNowGlance() {
  const sample = DATA.source === 'synthetic';
  const asOf = DATA.fetchedAt ? new Date(DATA.fetchedAt) : null;
  const recorded = asOf && CGM_NOW.mgdl != null ? new Date(asOf.getTime() - CGM_NOW.ageMin * 60000) : null;
  const loopTime = asOf && DATA.CGM_NOW.statusAt ? new Date(DATA.CGM_NOW.statusAt) : null;
  const clock = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="face current-glance">
      <div className="current-top">
        <strong className="current-reading">
          <Num value={CGM_NOW.mgdl} />
          <span className="current-trend" role="img" aria-label={CGM_NOW.trendLabel}>{CGM_NOW.trend}</span>
          <small>mg/dL</small>
        </strong>
        <LoopPill minutes={sample ? PATIENT.loopedMinAgo : loopTime && asOf ? Math.max(0, Math.round((asOf.getTime() - loopTime.getTime()) / 60000)) : null} />
      </div>
      <NowStatusLine />
      {!sample && recorded && <span className="caption gl-read-at">Reading from {clock(recorded)}</span>}
      {/* One stack, hairlines between: each fact is a small grey label over a number. */}
      <dl className="stat-stack">
        <div><dt>Active insulin</dt><dd>{CGM_NOW.activeInsulinU == null ? '—' : <><Num value={CGM_NOW.activeInsulinU} digits={2} /><small>U</small></>}</dd></div>
        <div><dt>Active carbs</dt><dd>{CGM_NOW.activeCarbsG == null ? '—' : <><Num value={CGM_NOW.activeCarbsG} /><small>g</small></>}</dd></div>
        <div><dt>In range · {PERIOD.days}d</dt><dd>{READ.meanMgdl > 0 ? <><Num value={READ.mine.inRangePct} digits={READ.mine.inRangePct % 1 ? 1 : 0} /><small>%</small></> : '—'}</dd></div>
      </dl>
      <Fit className="grow" minH={36}>
        {({ w, h }) => { const v = cgmWindow(3); return <CgmChart compact W={w} H={h} readings={v.readings} prediction={CGM_NOW.prediction} x0={v.x0} x1={v.x1} label={cgmWindowLabel(3)} />; }}
      </Fit>
      <span className="caption gl-foot">Dots: your CGM · dashed: Loop’s prediction</span>
    </div>
  );
}

/** Hours the detail can show, like a CGM receiver. */
const CGM_SPANS = ['3', '6', '12', '24'] as const;
type CgmSpan = (typeof CGM_SPANS)[number];

/** The last `span` hours of readings, ending now, plus room for Loop's prediction. */
function cgmWindow(span: number) {
  const day = CGM_NOW.day?.length ? CGM_NOW.day : CGM_NOW.points;
  const now = day.length ? day[day.length - 1][0] : 0;
  const predEnd = CGM_NOW.prediction.length ? CGM_NOW.prediction[CGM_NOW.prediction.length - 1][0] : now;
  // The prediction gets a fixed share of the width, so a 24-hour view isn't squashed by it.
  const ahead = Math.min(predEnd - now, span <= 3 ? 1.5 : span <= 6 ? 1.5 : span / 8);
  const x0 = now - span;
  return { readings: day.filter(([h]) => h >= x0), x0, x1: now + Math.max(ahead, span / 12) };
}

function cgmWindowLabel(span: number): string {
  const { readings } = cgmWindow(span);
  if (!readings.length || CGM_NOW.mgdl == null) return 'No recent CGM readings.';
  const hi = readings.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lo = readings.reduce((a, b) => (b[1] < a[1] ? b : a));
  const below = readings.filter(([, v]) => v < BANDS.low).length;
  const pr = CGM_NOW.prediction;
  const prText = pr.length ? ` Loop’s prediction, dashed, runs from ${Math.round(Math.min(...pr.map((p) => p[1])))} to ${Math.round(Math.max(...pr.map((p) => p[1])))} mg/dL.` : '';
  return `Glucose, one dot per reading, over the last ${span} hours: between ${lo[1]} and ${hi[1]} mg/dL${below ? `, ${below} ${below === 1 ? 'reading' : 'readings'} under ${BANDS.low}` : ''}; now ${CGM_NOW.mgdl} mg/dL, ${CGM_NOW.trendLabel}.${prText}`;
}

function GlucoseNowDetail() {
  const [span, setSpan] = useState<CgmSpan>('3');
  const v = cgmWindow(Number(span));
  const lows = v.readings.filter(([, g]) => g < BANDS.low).length;
  const highs = v.readings.filter(([, g]) => g > BANDS.high).length;
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Glucose now">
        <CgmNumber big />
        <LoopLine />
        <div className="row between wrap">
          <p className="small">{v.readings.length} readings · {lows ? `${lows} under ${BANDS.low}` : `none under ${BANDS.low}`} · {highs ? `${highs} over ${BANDS.high}` : `none over ${BANDS.high}`}</p>
          <Segmented size="sm" label="Hours shown" value={span} onChange={setSpan} items={CGM_SPANS.map((s) => ({ value: s, label: `${s}h` }))} />
        </div>
        <Fit className="chart-lg">
          {({ w, h }) => <CgmChart W={w} H={h} readings={v.readings} prediction={CGM_NOW.prediction} x0={v.x0} x1={v.x1} label={cgmWindowLabel(Number(span))} />}
        </Fit>
        <span className="caption">Each dot is a CGM reading: red under {BANDS.low}, amber over {BANDS.high}. Dashed past Now is Loop’s prediction. Hover a dot for its time.</span>
      </section>
      <aside className="panel stack-12" aria-label="About this reading">
        <h3 className="h3">Where this comes from</h3>
        <p className="small">{DATA.source === 'nightscout' ? `Your CGM reading, from your Nightscout at ${DATA.sourceLabel}.` : 'Your Dexcom G7 reading, through Loop.'} A reading older than 15 minutes greys out and says so.</p>
        <dl className="facts">
          <div><dt>Trend</dt><dd>{CGM_NOW.trend} {CGM_NOW.trendLabel}</dd></div>
          <div><dt>Active insulin</dt><dd>{CGM_NOW.activeInsulinU == null ? '—' : `${CGM_NOW.activeInsulinU.toFixed(2)} U`}</dd></div>
          <div><dt>Active carbs</dt><dd>{CGM_NOW.activeCarbsG == null ? '—' : `${CGM_NOW.activeCarbsG} g`}</dd></div>
          <div><dt>Loop</dt><dd>looped {PATIENT.loopedMinAgo} min ago</dd></div>
        </dl>
        <p className="caption">LoopStack reads what Loop did. It never changes your pump.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ heads-ups (PROD-2)

function HeadsUpCard() {
  if (!HEADS_UP) {
    return (
      <div className="headsup">
        <span className="badge"><IBell /></span>
        <div className="stack">
          <span className="caption">Heads-up · today</span>
          <span className="lead-sm">No heads-up today</span>
          <span className="small">A weekday pattern needs at least three sampled weeks.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="headsup">
      <span className="badge"><IBell /></span>
      <div className="stack">
        <span className="caption">Heads-up · {HEADS_UP.when}</span>
        <span className="lead-sm">{HEADS_UP.title}</span>
        <span className="small">{HEADS_UP.detail}</span>
      </div>
    </div>
  );
}

function HeadsUpsGlance({ go, h }: FaceProps) {
  return (
    <div className="face">
      <HeadsUpCard />
      {h > 1 && <p className="small">{DATA.source === 'synthetic' ? 'Hourly patterns from up to 12 weeks.' : 'Nightscout history · Hourly patterns from up to 12 weeks.'}</p>}
      <button type="button" className="text-btn" onClick={() => go({ tile: 'hour-evidence', evidence: { weekday: HEADS_UP?.weekday ?? DAY.weekday, hour: HEADS_UP?.stretch[0] ?? 12 } })}>{HEADS_UP ? 'Inspect those hours' : 'Explore weekday hours'}</button>
    </div>
  );
}

function HeadsUpsDetail({ go }: FaceProps) {
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Today’s heads-ups">
        {TEXT.headsUpBody && <p className="takeaway">{TEXT.headsUpBody}</p>}
        <HeadsUpCard />
        {/* The day's chart lives in the day tracker; this view says what and when, then goes there. */}
        <div className="row wrap">
          <button type="button" className="quiet-btn" onClick={() => go({ tile: 'day-tracker' })}>See the average {DAY.name} in the day tracker</button>
          <button type="button" className="text-btn" onClick={() => go({ tile: 'hour-evidence' })}>Check the hours behind it</button>
        </div>
      </section>
      <aside className="panel stack-12" aria-label="How heads-ups work">
        <h3 className="h3">About heads-ups</h3>
        <p className="small">A heads-up comes two hours before a weekday stretch that has often run low or high. At most 3 a day.</p>
        <details className="method">
          <summary className="small strong">How one is picked</summary>
          <p className="small">At least 10% of the stretch’s readings ran low or high over the last 12 weeks, with at least 3 weeks behind each hour.</p>
        </details>
        <p className="caption">An observation, not a cause. Always on your dashboard.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ day tracker (PROD-2)

// The day picker is shared with every focused view (ui/Focus.tsx): Every day, Weekdays, Weekends, Sun to Sat.

function DayLegend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li><svg width="16" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" style={{ fill: 'var(--range-in)' }} /><circle cx="12" cy="4" r="3.5" style={{ fill: 'var(--range-low)' }} /></svg>Glucose, low is the larger dot</li>
      <li><span className="sw" style={{ background: 'var(--graph-insulin)' }} />Active insulin</li>
      <li><span className="sw" style={{ background: 'var(--graph-carb)' }} />Active carbs</li>
      <li><span className="sw" style={{ background: 'var(--graph-activity)' }} />Exercise, minutes</li>
    </ul>
  );
}

const nowHours = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

function DayTrackerBody({ big, day: shared, onDay }: { big: boolean; day?: DayPick; onDay?: (d: DayPick) => void }) {
  const [own, setOwn] = useState<DayPick>(dayPickOf(DAY.weekday));
  const day = shared ?? own;
  const setDay = onDay ?? setOwn;
  const idx = dayPickIndex(day);
  const every = idx >= 7;
  const name = dayPickName(day);
  const tracked = DAY_BY_WEEKDAY[idx] ?? null;
  const span = tracked ? (tracked.days ? `${tracked.days} days` : `${tracked.weeks} ${tracked.weeks === 1 ? 'week' : 'weeks'}`) : '';
  return (
    <>
      <div className="row between wrap">
        {/* In the tile, one row: All and the seven weekdays. The focused view adds Weekdays and Weekends. */}
        <DayPicker compact={!big} value={day} onChange={setDay} />
        <span className="caption">{idx === 7 ? 'The average day' : idx >= 8 ? `The average of ${name}` : `The average ${name.slice(0, -1)}`}{span ? `, ${span} in this period` : ''} · median by hour</span>
      </div>
      {tracked ? (
        <Fit className={big ? 'chart-lg' : 'grow'} minH={120}>{({ w, h }) => <DayTrackerChart day={tracked} W={w} H={h} compact={!big} now={every ? nowHours() : tracked.weekday === new Date().getDay() || DATA.source === 'synthetic' ? undefined : null} />}</Fit>
      ) : DATA.source === 'synthetic' && PERIOD.days <= 14 ? (
        <div className="empty-inline grow">
          <p className="lead-sm">Only Fridays are in this 14-day sample.</p>
          <p className="small">Pick 30 days or more in the top bar to see every weekday. {name[0].toUpperCase() + name.slice(1)} shows nothing here rather than a guess.</p>
        </div>
      ) : (
        <div className="empty-inline grow">
          <p className="lead-sm">{every ? 'Not enough days yet.' : `Not enough ${name} yet.`}</p>
          <p className="small">An hour needs at least 2 of the same weekday (4 days for weekdays or weekends) before it says anything. A longer period in the top bar may have enough.</p>
        </div>
      )}
    </>
  );
}

function DayTrackerGlance() {
  return <div className="face"><DayTrackerBody big={false} /></div>;
}

/** What the selected day shows, said plainly; the dataset's own sentence for the default day. */
function dayFindingFor(d: (typeof DAY_BY_WEEKDAY)[number]): string {
  if (!d) return 'Not enough data for this day yet.';
  if (d.weekday === DAY.weekday) return TEXT.dayTrackerFinding;
  const lo = d.glucose.reduce((b, g, h) => (g < d.glucose[b] ? h : b), 0);
  const hi = d.glucose.reduce((b, g, h) => (g > d.glucose[b] ? h : b), 0);
  const ip = d.iob.reduce((b, g, h) => (g > d.iob[b] ? h : b), 0);
  const what = d.weekday === 7 ? 'On the average day' : `On the average ${d.name}`;
  return `${what}, glucose is lowest at ${hourName(lo)}, ${d.glucose[lo]} mg/dL, and highest at ${hourName(hi)}, ${d.glucose[hi]} mg/dL. Active insulin peaks at about ${d.iob[ip].toFixed(1)} U around ${hourName(ip)}.`;
}

function DayTrackerDetail() {
  const [day, setDay] = useState<DayPick>(dayPickOf(DAY.weekday));
  const [view, setView] = useState<FocusView>('chart');
  const selected = DAY_BY_WEEKDAY[dayPickIndex(day)] ?? null;
  const rows = selected ? selected.glucose.map((g, h) => [hourName(h), g, selected.iob[h], selected.cob[h], selected.exercise[h] ?? 0] as const) : [];
  const csv = () => downloadCsv(`loopstack-day-tracker-${day}-${PERIOD.days}d.csv`, ['Hour', 'Glucose median (mg/dL)', 'Active insulin (U)', 'Active carbs (g)', 'Exercise (min)'], rows);
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Day tracker">
        <FocusBar covers={`${PERIOD.label} · ${PERIOD.days} days, the period in the top bar`} view={view} onView={setView} onCsv={csv} />
        <p className="takeaway">{dayFindingFor(selected)}</p>
        {view === 'chart' ? (
          <>
            <DayTrackerBody big day={day} onDay={setDay} />
            <DayLegend />
          </>
        ) : (
          <>
            <DayPicker value={day} onChange={setDay} />
            {selected ? (
              <div className="focus-table-wrap">
                <table className="table focus-table">
                  <caption className="sr-only">The average {dayPickName(day)} by hour: glucose, active insulin, active carbs and exercise</caption>
                  <thead><tr><th scope="col">Hour</th><th scope="col" className="num">Glucose, mg/dL</th><th scope="col" className="num">Active insulin, U</th><th scope="col" className="num">Active carbs, g</th><th scope="col" className="num">Exercise, min</th></tr></thead>
                  <tbody>{rows.map(([hr, g, i, c, e]) => (
                    <tr key={hr}><th scope="row">{hr}</th><td className={`num${g < BANDS.low ? ' low' : g > BANDS.high ? ' high' : ''}`}>{g}</td><td className="num">{i}</td><td className="num">{c}</td><td className="num">{e || '—'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="small">Not enough {dayPickName(day)} in this period. A longer period in the top bar may have enough.</p>}
          </>
        )}
      </section>
      <aside className="panel stack-12" aria-label="Reading the day">
        <h3 className="h3">Reading the day</h3>
        <p className="small">Each line is the median of that hour across the days picked: glucose, active insulin, active carbs and exercise, side by side so you can see what moved together.</p>
        {TEXT.dayTrackerLoop && selected?.weekday === DAY.weekday && <p className="small">{TEXT.dayTrackerLoop}</p>}
        <p className="caption">What happened, not why. Always on your dashboard.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ what Loop did

const SHORT = { a: 'about', l: 'less', m: 'more', s: 'suspended' } as const;
export const colLabel = (mode: Mode, col: number) => (mode === 'hours' ? hourName(col) : rangeLabel(col * 3, col * 3 + 3));
export const readout = (mode: Mode, col: number) => {
  const s = select(mode, col);
  return `${colLabel(mode, col)} · ${SHORT[s.verdict]} on ${s.n} of ${USABLE_N} · ${s.loop.toFixed(2)} of ${s.sched.toFixed(2)} U/h`;
};

export function gridFinding(mode: Mode, clinician = false): string {
  if (DATA.source !== 'synthetic') return genericGridFinding(mode, clinician);
  const insulin = clinician ? 'algorithm-modulated basal ran below the scheduled rate' : 'Loop delivered less than scheduled';
  if (mode === 'blocks') {
    const b = blocks();
    return `What Loop did in 3-hour blocks over 14 days. 6 to 9am: ${insulin} on ${b[2].counts.l} of ${USABLE_N} usable days, about ${Math.abs(Math.round(diff(b[2].loop, b[2].sched) * 100))}% under. 6 to 9pm is above scheduled on ${b[6].counts.m} of ${USABLE_N}. Both Fridays are suspended 3 to 6pm after a lunchtime run. Sun Nov 8 lost its pod connection 12 to 6am and is not counted.`;
  }
  return `What Loop did, hour by hour: 14 days by 24 hours. At 6am ${insulin} on ${count(6, 'l')} of ${USABLE_N} usable days, at 7am on ${count(7, 'l')}, and by 8am on only ${count(8, 'l')}. 7 to 9pm is above scheduled on ${count(19, 'm')} and ${count(20, 'm')} of ${USABLE_N}. Both Fridays are suspended 3 to 6pm after a lunchtime run. Sun Nov 8 lost its pod connection 12 to 6am and is not counted.`;
}

/** The grid's spoken summary for any dataset: the hour (or block) where Loop most often ran less, and more. */
function genericGridFinding(mode: Mode, clinician: boolean): string {
  const cols = mode === 'blocks' ? 8 : 24;
  const best = (v: 'l' | 'm') => {
    let top: { col: number; n: number } | null = null;
    for (let c = 0; c < cols; c += 1) {
      const sel = select(mode, c);
      if (sel.verdict === v && (!top || sel.n > top.n)) top = { col: c, n: sel.n };
    }
    return top;
  };
  const less = best('l');
  const more = best('m');
  const lessWord = clinician ? 'algorithm-modulated basal ran below the scheduled rate' : 'Loop delivered less than scheduled';
  const moreWord = clinician ? 'ran above the scheduled rate' : 'Loop delivered more than scheduled';
  const parts = [`What Loop did, ${mode === 'blocks' ? 'in 3-hour blocks' : 'hour by hour'}: ${PERIOD.days} days by 24 hours, ${USABLE_N} usable.`];
  parts.push(less ? `At ${colLabel(mode, less.col)} ${lessWord} on ${less.n} of ${USABLE_N} days.` : 'No hour ran less than scheduled on most days.');
  if (more) parts.push(`At ${colLabel(mode, more.col)} ${moreWord} on ${more.n} of ${USABLE_N} days.`);
  if (TEXT.excludedNote) parts.push(`${TEXT.excludedNote}.`);
  return parts.join(' ');
}

export function GridLegend() {
  return (
    <ul className="chips" aria-label="Legend">
      <Chip kind="l">Less</Chip>
      <Chip kind="m">More</Chip>
      <Chip kind="s">Suspended</Chip>
      <Chip kind="x">No data</Chip>
      <Chip kind="run">{DATA.source === 'synthetic' ? 'Lunchtime run' : 'Exercise'}</Chip>
    </ul>
  );
}



export function HourDetail({ mode, sel, clinician = false }: { mode: Mode; sel: number; clinician?: boolean }) {
  const s = select(mode, sel);
  const daysWord = mode === 'hours' && s.verdict !== 'a' ? partOfDay(s.start).many : 'days';
  const others = s.others.length && s.others.length <= 4 ? ` The other ${s.others.length === 1 ? 'one' : s.others.length}: ${s.others.join(', ')}.` : '';
  const loopWord = clinician ? 'algorithm-modulated basal ran' : 'Loop delivered';
  const sentence = s.verdict === 'a'
    ? `At ${colLabel(mode, sel)} ${loopWord} about as scheduled on ${s.n} of ${USABLE_N} days.${others}`
    : s.verdict === 's'
      ? `At ${colLabel(mode, sel)} Loop suspended on ${s.n} of ${USABLE_N} days${TEXT.suspendNote ? `, ${TEXT.suspendNote}` : ''}.`
      : `At ${colLabel(mode, sel)} ${loopWord} ${s.verdict === 'l' ? 'less' : 'more'} than scheduled on ${s.n} of ${USABLE_N} days.${others}`;
  return (
    <div className="stack-12">
      <div className="row between baseline">
        <h3 className="title">{rangeLabel(s.start, s.end)}</h3>
        <span className="caption">{USABLE_N} usable days</span>
      </div>
      <div className="tiles3">
        <div className="stat"><b>{s.sched.toFixed(2)} U/h</b><span>scheduled</span></div>
        <div className="stat"><b>{s.loop.toFixed(2)} U/h</b><span>{clinician ? 'delivered, median' : 'Loop, median'}</span></div>
        <div className="stat"><b>{s.n} of {USABLE_N}</b><span>{daysWord} {SHORT[s.verdict]}</span></div>
      </div>
      <p className="small ink">{sentence}</p>
    </div>
  );
}

export function WhatLoopDidExplorer({ route, go, clinician = false }: { route: Route; go: Go; clinician?: boolean }) {
  const { mode, sel } = route;
  const [a, b] = stretchOf(mode, sel);
  const [drill, setDrill] = useState(false);
  const part = partOfDay(a);
  const g = a === 6 ? morningGlucose(6) : null;
  const announce = useAnnounce();
  const pick = (col: number) => {
    go({ sel: col }, { replace: true });
    setDrill(false);
  };
  const morningLabel = `${rangeLabel(a, b)}, ${part.one} by ${part.one}. Bars are delivered basal for each hour; the dotted line is the scheduled rate.${g ? ` On the right, glucose at 6am. Mornings where Loop delivered less sat lower at 6am, median ${g.lessMedian} mg/dL, than the two that ran as scheduled, ${g.about.join(' and ')} mg/dL.` : ''}${TEXT.excludedNote ? ` ${TEXT.excludedNote}.` : ''}`;
  return (
    <div className={`explorer${clinician ? " stacked" : ""}`}>
      <section className="panel stack-12" aria-label="Hour grid">
        {/* In the care-team review every style names this as Loop's own adjustments, hour by hour. */}
        {clinician && <h3 className="label">What Loop did · its adjustments against the schedule, hour by hour</h3>}
        <div className="row between wrap">
          <div className="row wrap">
            <span className="sample">{PERIOD.days} days · {USABLE_N} usable</span>
            <span className="caption">{PERIOD.label} · ±15% counts as scheduled</span>
          </div>
          <Segmented
            label="Detail"
            items={[{ value: 'blocks', label: '3-hour blocks' }, { value: 'hours', label: 'Hours' }]}
            value={mode}
            onChange={(m) => {
              if (m === mode) return;
              go({ mode: m, sel: m === 'blocks' ? Math.floor(sel / 3) : sel * 3 + 1 }, { replace: true });
              announce(m === 'blocks' ? 'Showing 3-hour blocks' : 'Showing hours');
            }}
          />
        </div>
        <GridLegend />
        <Fit className="grid-fit">
          {({ w }) => {
            const RH = 20;
            const geo = gridGeom(mode, w, RH);
            const center = geo.x(sel) + geo.cw / 2;
            return (
              <div style={{ position: 'relative', paddingTop: 40 }}>
                <div role="status" aria-live="polite" className="readout glass" style={{ transform: `translateX(${Math.max(0, Math.min(center - 130, w - 260))}px)` }}>
                  {readout(mode, sel)}
                </div>
                <HourGrid mode={mode} sel={sel} onSelect={pick} label={gridFinding(mode, clinician)} valueText={readout(mode, sel)} W={w} RH={RH} />
              </div>
            );
          }}
        </Fit>
        <p className="caption"><span className="screen-only">Click a column, or focus the grid and use the arrow keys.</span>{NOT_COUNTED ? ` ${TEXT.excludedNote}: ${NOT_COUNTED_CAUSE.toLowerCase()}.` : ''}</p>
      </section>
      <aside className="panel stack-16 side" aria-label="Selected hour">
        <HourDetail mode={mode} sel={sel} clinician={clinician} />
        <button type="button" className="quiet-btn" aria-expanded={drill} aria-controls="drill" onClick={() => setDrill((d) => !d)}>
          {drill ? `Hide the ${part.many}` : `See ${rangeLabel(a, b)}, ${part.one} by ${part.one}`}
        </button>
        {drill && (
          <div id="drill" className="stack-12">
            <Fit className="drill-fit">{({ w }) => <MorningsChart from={a} to={b} W={w} label={morningLabel} />}</Fit>
            {g ? (
              <p className="small ink">On the mornings Loop delivered less, 6am glucose sat lower: median {g.lessMedian} mg/dL, against {g.about.join(' and ')} on the two that ran as scheduled. An observation, not a cause.</p>
            ) : (
              <p className="small">Glucose for each {part.one} at {hourName(a)} isn’t in this sample, so there’s nothing to set alongside.</p>
            )}
          </div>
        )}
        {!clinician && DATA.source === 'synthetic' && (
          <div className="stack-4 evenings">
            <span className="label">Evenings</span>
            <span className="small ink">7–9pm, Loop delivered about 25% more than scheduled on {count(19, 'm')}–{count(20, 'm')} of {USABLE_N} evenings.</span>
          </div>
        )}
        {!clinician && DATA.source !== 'synthetic' && TEXT.eveningNote && (
          <div className="stack-4 evenings">
            <span className="label">Evenings</span>
            <span className="small ink">{TEXT.eveningNote}</span>
          </div>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ before and after

const BA_GEOM = { x0: 6, x1: 22 };
const time = (h: number) => `${Math.floor(h) % 12 || 12}${h % 1 ? `:${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
const baSeries = () => [
  { pts: LUNCH.before, stroke: 'var(--ink-500)', width: 2, dash: '4 3', opacity: 0.9 },
  { pts: LUNCH.after, stroke: 'var(--ink-900)', width: 2.4 },
];
export function baLabel() {
  const pb = peak(LUNCH.before);
  const pa = peak(LUNCH.after);
  if (DATA.source !== 'synthetic') {
    return `Lunch, ${LUNCH.beforeLabel.toLowerCase()} against ${LUNCH.afterLabel.toLowerCase()}, median glucose. The median peak was ${pb[1]} mg/dL at ${time(pb[0])} before and ${pa[1]} mg/dL at ${time(pa[0])} after.`;
  }
  return `Lunch, ${LUNCH.usable.days} days before and after the carb ratio change, median glucose. The median peak at ${time(pb[0])} was ${pb[1]} mg/dL before and ${pa[1]} mg/dL after, about ${pb[1] - pa[1]} mg/dL lower. Outside 12 to 4pm the two lines sit within a few mg/dL of each other.`;
}

/** "lunch peaks were about 20 mg/dL lower", either direction. */
export function lunchPeakText(): string {
  const d = peak(LUNCH.before)[1] - peak(LUNCH.after)[1];
  const lead = CHANGES.some((c) => c.status === 'applied' || c.status === 'reviewed') ? 'After the change' : `In the last ${LUNCH.usable.days} days`;
  return Math.abs(d) < 5
    ? `${lead}, lunch peaks were within ${Math.max(1, Math.abs(d))} mg/dL of before.`
    : `${lead}, lunch peaks were about ${Math.abs(d)} mg/dL ${d > 0 ? 'lower' : 'higher'}.`;
}

export function BaLegend() {
  return (
    <div className="row wrap caption" style={{ gap: 14 }}>
      <span className="row" style={{ gap: 6 }}><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: 'var(--ink-500)' }} strokeWidth="2" strokeDasharray="4 3" /></svg>Before</span>
      <span className="row" style={{ gap: 6 }}><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.4" /></svg>After</span>
      <span>{rangeLabel(LUNCH.scope[0], LUNCH.scope[1])} shaded · median, mg/dL</span>
    </div>
  );
}

export function BaChart({ className = 'grow', minH = 100 }: { className?: string; minH?: number }) {
  return (
    <Fit className={className} minH={minH}>
      {({ w, h }) => <GlucoseChart geom={{ W: w, H: h, ...BA_GEOM }} scope={LUNCH.scope} series={baSeries()} label={baLabel()} />}
    </Fit>
  );
}

function BeforeAfterGlance() {
  return (
    <div className="face">
      <p className="lead-sm">{lunchPeakText()}</p>
      <span className="caption">{LUNCH.change} · {LUNCH.usable.days} days each side, {LUNCH.usable.before} usable</span>
      <BaChart />
      <BaLegend />
    </div>
  );
}

function BeforeAfterDetail() {
  const pb = peak(LUNCH.before);
  const pa = peak(LUNCH.after);
  const change = CHANGES.find((c) => c.status === 'applied' || c.status === 'reviewed');
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Before and after chart">
        <div className="row wrap">
          <span className="sample">{LUNCH.usable.days} days before · {LUNCH.usable.before} usable</span>
          <span className="sample">{LUNCH.usable.days} days after · {LUNCH.usable.after} usable</span>
        </div>
        <p className="takeaway">{lunchPeakText().replace(/\.$/, '')}: {pb[1]} → {pa[1]} mg/dL at {time(pb[0])}, {pct((pa[1] - pb[1]) / pb[1])}.</p>
        <BaChart className="chart-lg" />
        <BaLegend />
      </section>
      <aside className="panel stack-12" aria-label="The change">
        <h3 className="h3">{change ? 'The change' : 'The two sides'}</h3>
        {change ? (
          <dl className="facts">
            <div><dt>Setting</dt><dd>{change.setting}, {change.from} → {change.to}</dd></div>
            <div><dt>Date</dt><dd>{change.date}, left out of both sides</dd></div>
            <div><dt>Proposed</dt><dd>{change.proposedBy === PATIENT.first ? 'You' : change.proposedBy}</dd></div>
            <div><dt>Agreed</dt><dd>{change.agreedBy ?? 'Not recorded'}</dd></div>
            <div><dt>Review</dt><dd>{change.reviewDate ?? 'Not set'}</dd></div>
          </dl>
        ) : (
          <p className="small">{LUNCH.change}.</p>
        )}
        <p className="small">{TEXT.lunchContext}</p>
        <p className="caption">What happened after the change, not proof the change did it.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ time in range

function TirLegend() {
  return (
    <ul className="tir-legend">
      {bands('mine').map((b) => (
        <li key={b.key} className={b.key === 'in' ? 'in' : ''}>
          <span className="sw" style={{ background: b.fill }} />
          <span>{b.label}</span>
          <span className="num">{b.pct}%</span>
        </li>
      ))}
    </ul>
  );
}

function TimeInRangeGlance({ h }: FaceProps) {
  return (
    <div className="face">
      <div className="row baseline" style={{ gap: 8 }}>
        <span className="big-num"><Num value={READ.mine.inRangePct} digits={READ.mine.inRangePct % 1 ? 1 : 0} /><small>%</small></span>
        <span className="small">in range {rangeText()} · {PERIOD.days} days</span>
      </div>
      {h > 1 ? (
        <div className="row grow" style={{ alignItems: 'stretch', gap: 16 }}>
          <Fit className="tir-fit">{({ w, h: hh }) => <TirBar W={w} H={hh} labels={false} set="mine" />}</Fit>
          <TirLegend />
        </div>
      ) : (
        <span className="small">Low {READ.mine.lowPct}% · urgent low {READ.mine.urgentPct}%</span>
      )}
      {h > 2 && <DayRings days={DAILY.days.slice(-5)} today={DAILY.today} size={32} />}
    </div>
  );
}

function TimeInRangeDetail() {
  const goals: Record<string, string> = { 'very-high': 'under 5%', high: 'under 25% with very high', in: 'over 70%', low: 'under 4% with very low', 'very-low': 'under 1%' };
  const [view, setView] = useState<FocusView>('chart');
  const [day, setDay] = useState<DayPick>('all');
  const days = DAILY.days.filter((d) => inPick(d.label, day));
  const pctOr = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);
  const csv = () => downloadCsv(`loopstack-time-in-range-${PERIOD.days}d.csv`, ['Day', 'Counted', 'Mean (mg/dL)', `In range ${rangeText()} (%)`, `Below ${BANDS.low} (%)`, `Under ${BANDS.urgentLow}, urgent (%)`, `Above ${BANDS.high} (%)`, 'Readings'],
    days.map((d) => [d.label, d.usable ? 'yes' : 'no', d.meanMgdl, d.inRangePct, d.belowPct, d.urgentPct, d.abovePct, d.readings]));
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Time in range">
        <FocusBar covers={`${PERIOD.label} · ${PERIOD.days} days, the period in the top bar`} view={view} onView={setView} onCsv={csv} />
        {view === 'table' ? (
          <>
            <DayPicker value={day} onChange={setDay} />
            <div className="focus-table-wrap">
              <table className="table focus-table">
                <caption className="sr-only">Time in range for each day of the period</caption>
                <thead><tr><th scope="col">Day</th><th scope="col" className="num">In range</th><th scope="col" className="num">Below {BANDS.low}</th><th scope="col" className="num">Urgent, under {BANDS.urgentLow}</th><th scope="col" className="num">Above {BANDS.high}</th><th scope="col" className="num">Mean, mg/dL</th><th scope="col" className="num">Readings</th></tr></thead>
                <tbody>{[...days].reverse().map((d) => (
                  <tr key={d.day} className={d.usable ? undefined : 'muted'}>
                    <th scope="row">{d.label}{d.usable ? '' : <span className="caption"> · not counted</span>}</th>
                    <td className="num strong">{pctOr(d.inRangePct)}</td><td className={`num${(d.belowPct ?? 0) >= 4 ? ' low' : ''}`}>{pctOr(d.belowPct)}</td><td className={`num${(d.urgentPct ?? 0) >= 1 ? ' low' : ''}`}>{pctOr(d.urgentPct)}</td><td className={`num${(d.abovePct ?? 0) >= 25 ? ' high' : ''}`}>{pctOr(d.abovePct)}</td><td className="num">{d.meanMgdl ?? '—'}</td><td className="num">{d.readings}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="caption">Newest first. {days.length} {days.length === 1 ? 'day' : 'days'} ({dayPickName(day)}). Below {BANDS.low} is marked at 4% or more, urgent at 1% or more and above {BANDS.high} at 25% or more, the common goals.</p>
          </>
        ) : (<>
        <div className="row baseline" style={{ gap: 8 }}>
          <span className="big-num">{READ.mine.inRangePct}%</span>
          <span className="small">in range {rangeText()}, {PERIOD.label}</span>
          <DeltaChip now={READ.mine.inRangePct} prev={READ.prev?.inRangePct} unit=" pts" />
        </div>
        {weakestDay(DAILY.days, READ.mine.inRangePct) && <p className="small ink">{weakestDay(DAILY.days, READ.mine.inRangePct)}</p>}
        <DayRings days={DAILY.days} today={DAILY.today} />
        <p className="caption">{ringKey(DAILY.days.length)}</p>
        <div className="row" style={{ alignItems: 'stretch', gap: 24, height: 280 }}>
          <Fit className="tir-fit">{({ w, h }) => <TirBar W={w} H={h} labels={false} set="mine" />}</Fit>
          <table className="table">
            <caption className="sr-only">Time in each glucose band</caption>
            <thead><tr><th scope="col">Band</th><th scope="col">mg/dL</th><th scope="col" className="num">You</th><th scope="col">Common goal</th></tr></thead>
            <tbody>
              {bands('mine').map((b) => (
                <tr key={b.key}>
                  <th scope="row"><span className="sw" style={{ background: b.fill }} /> {b.label}</th>
                  <td>{b.range}</td>
                  <td className="num strong">{b.pct}%</td>
                  <td>{goals[b.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>)}
      </section>
      <aside className="panel stack-12" aria-label="About the bands">
        <h3 className="h3">About the bands</h3>
        <p className="small">{isStandard()
          ? 'The five bands from the standard glucose report, the one most clinics print.'
          : `Your bands, from Settings → Your ranges: urgent low under ${BANDS.urgentLow}, low ${BANDS.urgentLow}–${BANDS.low - 1}, in range ${rangeText()}. Standard reports score 70–180 with urgent under 54, so these figures won’t match Clarity or a clinic report. The care-team review keeps the standard bands (${READ.inRangePct}% in 70–180).`}</p>
        <p className="small">Sensor worn {READ.sensorWornPct}% of the time{READ.sensorWornPct >= 70 ? `, so the ${PERIOD.days} days have enough data to read` : `, under the 70% the standard report needs, so read these bands with care`}.</p>
        <p className="small">GMI {READ.gmiPct}% · variability (CV) {READ.cvPct}%.</p>
        <LowEvents />
      </aside>
    </div>
  );
}

/**
 * Lows as events, the phone's rule: 15 minutes under a line starts one, 15 back above ends it.
 * Low uses your low, urgent your urgent low (Settings → Your ranges). Observations only (SAFE-1).
 */
function LowEvents() {
  const L = DATA.LOWS;
  const len = (m: number | null) => (m == null ? null : `${Math.round(m)} min`);
  const row = (name: string, b: typeof L.low) => (
    <tr key={name}>
      <th scope="row">{name} <span className="caption">under {b.thresholdMgdl}</span></th>
      <td className="num strong">{b.all.count}</td>
      <td className="num">{b.all.count ? b.all.perWeek.toFixed(1) : '—'}</td>
      <td className="num">{b.all.lowestMgdl ?? '—'}</td>
    </tr>
  );
  const more = [L.low, L.urgentLow].filter((b) => b.all.count).map((b, i) => `${i ? 'Urgent lows' : 'Lows'} usually lasted ${len(b.all.medianDurationMin) ?? 'a short while'}, ${b.overnight.count} overnight`);
  return (
    <div className="stack-4 low-events">
      <h3 className="h3">Lows as events</h3>
      <table className="table">
        <caption className="sr-only">Low and urgent-low events over the period</caption>
        <thead><tr><th scope="col">Band</th><th scope="col" className="num">Events</th><th scope="col" className="num">A week</th><th scope="col" className="num">Lowest</th></tr></thead>
        <tbody>{row('Low', L.low)}{row('Urgent', L.urgentLow)}</tbody>
      </table>
      {more.length > 0 && <p className="small">{more.join('. ')}.</p>}
      <p className="caption">An event starts after 15 minutes under the line and ends after 15 back above it. Overnight is midnight to 6am. {L.daysCovered} of {L.windowDays} days had readings; a week counts only those days.</p>
    </div>
  );
}

// ------------------------------------------------------------ key numbers

// The phone's summary tiles (average glucose, estimated A1C, variability), same
// order and labels. No change chips yet: desktop has no prior-period reading to
// compare against, and a chip with nothing behind it would be a guess.
function KeyNumberTiles({ compact = false }: { compact?: boolean }) {
  // No readings yet: a dash, never a 0 that reads as a real number.
  const has = Number.isFinite(READ.meanMgdl) && READ.meanMgdl > 0;
  const p = READ.prev;
  const items: { label: string; value: string | number; unit: string; sub: string; now: number | null; before: number | null | undefined; dUnit: string; digits?: number }[] = [
    { label: 'Avg glucose', value: has ? Math.round(READ.meanMgdl) : '—', unit: 'mg/dL', sub: `${PERIOD.days}-day average`, now: has ? Math.round(READ.meanMgdl) : null, before: p?.meanMgdl, dUnit: ' mg/dL' },
    { label: 'Est. A1C', value: has && Number.isFinite(READ.gmiPct) ? READ.gmiPct : '—', unit: '%', sub: 'GMI', now: has ? READ.gmiPct : null, before: p?.gmiPct, dUnit: ' pts', digits: 1 },
    { label: 'Variability', value: has && Number.isFinite(READ.cvPct) ? Math.round(READ.cvPct) : '—', unit: '% CV', sub: 'How much glucose swings', now: has ? Math.round(READ.cvPct) : null, before: p?.cvPct, dUnit: ' pts' },
  ];
  return (
    <dl className={`key-numbers${compact ? ' compact' : ''}`}>
      {items.map((i) => (
        <div key={i.label} className="key-number">
          <dt className="label">{i.label}</dt>
          <dd><span className="big-num">{i.value}</span> <span className="small">{i.unit}</span></dd>
          {!compact && <dd className="caption">{i.sub}</dd>}
          {!compact && <dd><DeltaChip now={i.now} prev={i.before} unit={i.dUnit} digits={i.digits} /></dd>}
        </div>
      ))}
    </dl>
  );
}

function KeyNumbersGlance() {
  return <div className="face"><KeyNumberTiles compact /></div>;
}

function KeyNumbersDetail() {
  return (
    <div className="detail-grid">
      <section className="panel stack-16" aria-label="Key numbers">
        {READ.meanMgdl > 0 && <p className="takeaway">Average {Math.round(READ.meanMgdl)} mg/dL over {PERIOD.days} days: an estimated A1C of {READ.gmiPct}% and variability of {Math.round(READ.cvPct)}%{READ.cvPct < 36 ? ', under the common 36% goal' : ', over the common 36% goal'}.</p>}
        <KeyNumberTiles />
      </section>
      <aside className="panel stack-12" aria-label="About these numbers">
        <h3 className="h3">About these numbers</h3>
        <p className="small">GMI estimates what an A1C lab test might read from your sensor average. It can differ from a lab result. Variability is the standard deviation as a percent of your average; under 36% is the common goal.</p>
        <p className="caption">Sensor worn {READ.sensorWornPct}% of the time.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ device life

function DeviceRows() {
  const build = useLoopBuild();
  // The real build, when GitHub is connected; else the dataset's (the synthetic patient's).
  const buildDays = build ? daysLeft(build) : PATIENT.buildExpiresDays;
  return (
    <ul className="device">
      {DATA.source === 'synthetic' ? (
        <>
          <li><span className="label">Pod</span><b>2d 14h</b><span className="caption">of 3 days</span></li>
          <li><span className="label">Sensor</span><b>Day 7</b><span className="caption">of 10</span></li>
        </>
      ) : (
        <>
          <li><span className="label">Site</span><b>{PATIENT.podAge.replace(/^Site /, '')}</b><span className="caption">since the last site change</span></li>
          <li><span className="label">Sensor</span><b>{PATIENT.sensorDay.replace(/^Sensor /, '')}</b><span className="caption">since the last sensor start</span></li>
        </>
      )}
      {buildDays != null && <li><span className="label">Build</span><b>{buildDays < 0 ? 'Expired' : <>{buildDays}<small> days</small></>}</b><span className="caption">{buildDays < 0 ? 'build again' : 'left on TestFlight'}</span></li>}
    </ul>
  );
}

function DeviceLifeGlance() {
  return <div className="face"><DeviceRows /></div>;
}

function DeviceLifeDetail() {
  return (
    <div className="detail-grid">
      <section className="panel stack-16" aria-label="Device life">
        <DeviceRows />
        <p className="small">Quiet until it matters: a pod change, a sensor warm-up or a rebuild shows here a day ahead.</p>
      </section>
      <aside className="panel stack-12" aria-label="Your system">
        <h3 className="h3">Your system</h3>
        <dl className="facts">
          {/* From the data (Nightscout's devicestatus, or the sample patient), never typed in: it was hardcoded until Nov 24. */}
          {PATIENT.setup.split(' · ').map((part, i, all) => (
            <div key={i}><dt>{all.length === 3 ? ['App', 'Pump', 'CGM'][i] : i === 0 ? 'System' : 'Device'}</dt><dd>{part}</dd></div>
          ))}
          <div><dt>Looping</dt><dd>{READ.automationPct}% of the time</dd></div>
          <div><dt>Gaps</dt><dd>{READ.automationGaps}</dd></div>
        </dl>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ care-team thread

export function Thread({ side, limit }: { side: 'patient' | 'clinician'; limit?: number }) {
  const { thread } = useStore();
  const items = limit ? thread.slice(-limit) : thread;
  return (
    <ol className="thread" aria-label={side === 'patient' ? `Thread with ${PATIENT.clinician}` : `Thread with ${PATIENT.first}`}>
      {items.map((m: Msg, i) => (
        <li key={`${m.date}${i}`} className={`msg ${(m.from === 'sam') === (side === 'patient') ? 'mine' : ''}`}>
          <span className="caption">{who(m, side)} · {m.date}</span>
          {m.attach && <div className="attach">{m.attach}</div>}
          <div className="bubble">{m.text}</div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------ registry

export const FACES: Record<TileKind, { Glance: (p: FaceProps) => ReactNode; Detail: (p: FaceProps) => ReactNode }> = {
  'hour-evidence': { Glance: HourEvidence, Detail: HourEvidence },
  'review-queue': { Glance: ReviewQueue, Detail: ReviewQueue },
  'glucose-now': { Glance: GlucoseNowGlance, Detail: GlucoseNowDetail },
  'heads-ups': { Glance: HeadsUpsGlance, Detail: HeadsUpsDetail },
  'day-tracker': { Glance: DayTrackerGlance, Detail: DayTrackerDetail },
  'what-loop-did': { Glance: WhatLoopDidPatternsGlance, Detail: WhatLoopDidPatternsDetail },
  'before-after': { Glance: BeforeAfterGlance, Detail: BeforeAfterDetail },
  'time-in-range': { Glance: TimeInRangeGlance, Detail: TimeInRangeDetail },
  'key-numbers': { Glance: KeyNumbersGlance, Detail: KeyNumbersDetail },
  'hour-by-hour': { Glance: HourByHourGlance, Detail: HourByHourDetail },
  'device-life': { Glance: DeviceLifeGlance, Detail: DeviceLifeDetail },
  'care-thread': { Glance: CareThreadGlance, Detail: CareThreadDetail },
  meals: { Glance: FavoriteFoodsGlance, Detail: FavoriteFoodsDetail },
  'daily-glucose': { Glance: DailyGlucoseGlance, Detail: DailyGlucoseDetail },
};

export const tileTitle = (k: TileKind) => TILES[k].title;
