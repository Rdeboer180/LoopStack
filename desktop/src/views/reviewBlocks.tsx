// The care-team review's building blocks. A report style (data/reportStyles.ts)
// lays these out in the order and words a clinician already reads in; the
// numbers underneath are the same for every style. Observations only (SAFE-1),
// clinician terms by default (DATA-2).
import { AgpChart, bands, TirBar } from '../charts/Agp';
import { DailyChart } from '../charts/DailyChart';
import { reviewRead, tldrLines } from '../data/review';
import { CHANGES, DAILY, HEADS_UP, INSULIN, LUNCH, PATIENT, PERIOD, READ, TEXT, type SettingsChange } from '../data/current';
import { USABLE_N } from '../data/derive';
import { DEFAULT_TERMS, type BlockId, type Terms } from '../data/reportStyles';
import type { Go, Route } from '../nav';
import { BaChart, BaLegend, WhatLoopDidExplorer } from '../tiles/faces';
import { Fit, IChevron, useAnnounce } from '../ui/kit';
import { splitAtVisit, useCareNotes, useLastVisit, type CareNote } from '../data/careContact';
import { openCareNotes } from '../data/intent';
import type { DailyGlucose } from '../data/dataset';
import { STANDARD } from '../data/ranges';
import { YourLoopSettings } from './YourProfile';

export interface BlockProps { route: Route; go: Go; terms?: Terms; numbered?: boolean; onEvidence?: (section: string) => void }

export function ReviewBlock({ id, ...p }: BlockProps & { id: BlockId }) {
  const terms = p.terms ?? DEFAULT_TERMS;
  switch (id) {
    case 'read': return <ReadBlock terms={terms} numbered={p.numbered ?? true} />;
    case 'stats': return <StatsBlock terms={terms} />;
    case 'agp': return <AgpBlock terms={terms} numbered={p.numbered ?? true} />;
    case 'tir': return <TirBlock terms={terms} />;
    case 'tldr': return <TldrBlock onEvidence={p.onEvidence} />;
    case 'patterns': return <PatternsBlock />;
    case 'daily': return <DailyBlock />;
    case 'insulin': return <InsulinBlock terms={terms} />;
    case 'explorer': return <WhatLoopDidExplorer route={p.route} go={p.go} clinician />;
    case 'therapy': return <YourLoopSettings audience="clinician" />;
    case 'timeline': return <TimelineBlock />;
    case 'compare': return <CompareBlock terms={terms} />;
    case 'beforeAfter': return <BeforeAfterBlock />;
    case 'trends': return <TrendsBlock terms={terms} />;
    case 'notes': return <NotesBlock go={p.go} />;
  }
}

// ------------------------------------------------------------ glucose

function ReadBlock({ terms, numbered }: { terms: Terms; numbered: boolean }) {
  const read = reviewRead();
  const label = (k: string, l: string) => (k === 'sensor' ? terms.sensor : k === 'tir' ? terms.tir : k === 'automation' ? terms.automation : l);
  return (
    <section className="panel" aria-labelledby="read-h">
      <div className="row between baseline">
        <h3 id="read-h" className="label">The read · {PERIOD.days} days{numbered ? ' · in review order' : ''}</h3>
        <span className="caption">{terms.gmi} {READ.gmiPct}% · {terms.cv} {READ.cvPct}% · {terms.mean} {READ.meanMgdl} mg/dL</span>
      </div>
      <ol className="read" aria-label="Glucose read, in review order">
        {read.filter((r) => r.key !== 'agp').map((r) => (
          <li key={r.key} className={r.step ? '' : 'context'}>
            <span className="caption">{numbered && r.step ? `${r.step} · ` : ''}{label(r.key, r.label)}</span>
            <b className="read-num">{r.value}</b>
            <span className="caption">{r.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Summary statistics as a row of tiles: mean, GMI, CV, sensor use, days. */
function StatsBlock({ terms }: { terms: Terms }) {
  const stats = [
    { k: 'mean', label: terms.mean, value: `${READ.meanMgdl}`, unit: 'mg/dL' },
    { k: 'gmi', label: terms.gmi, value: `${READ.gmiPct}`, unit: '%' },
    { k: 'cv', label: terms.cv, value: `${READ.cvPct}`, unit: '%', note: 'goal 36% or lower' },
    { k: 'sensor', label: terms.sensor, value: `${READ.sensorWornPct}`, unit: '%', note: 'goal over 70%' },
    { k: 'auto', label: terms.automation, value: `${READ.automationPct}`, unit: '%' },
  ];
  return (
    <section className="panel" aria-labelledby="stats-h">
      <div className="row between baseline">
        <h3 id="stats-h" className="label">{terms.statsTitle}</h3>
        <span className="caption">{PERIOD.label} · {PERIOD.days} days</span>
      </div>
      <dl className="stat-tiles">
        {stats.map((s) => (
          <div key={s.k} className="stat-tile">
            <dt className="caption">{s.label}</dt>
            <dd><b className="read-num">{s.value}</b><span className="small"> {s.unit}</span></dd>
            {s.note && <dd className="caption">{s.note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function AgpBlock({ terms, numbered }: { terms: Terms; numbered: boolean }) {
  return (
    <section className="panel agp" aria-labelledby="agp-h">
      <div className="row between baseline">
        <h3 id="agp-h" className="label">{numbered ? '4 · ' : ''}{terms.agpTitle}</h3>
        <span className="caption">median, 25–75% and 5–95% · 70–180 mg/dL target</span>
      </div>
      <div className="agp-row">
        <Fit className="agp-fit">{({ w, h }) => <AgpChart W={w} H={h} />}</Fit>
        <div className="tir-col">
          <Fit className="tir-fit">{({ w, h }) => <TirBar W={w} H={h} labels={false} />}</Fit>
          <TirLegend />
        </div>
      </div>
    </section>
  );
}

function TirLegend() {
  return (
    <ul className="tir-legend">
      {bands().map((b) => (
        <li key={b.key} className={b.key === 'in' ? 'in' : ''}><span className="sw" style={{ background: b.fill }} /><span>{b.label}</span><span className="num">{b.pct}%</span></li>
      ))}
    </ul>
  );
}

/** The stacked time-in-ranges bar on its own, with the consensus goals beside it. */
function TirBlock({ terms }: { terms: Terms }) {
  const goals: Record<string, string> = { vhigh: 'under 5%', high: 'under 25% (with very high)', in: 'over 70%', low: 'under 4% (with very low)', vlow: 'under 1%' };
  return (
    <section className="panel" aria-labelledby="tirb-h">
      <h3 id="tirb-h" className="label">{terms.tirTitle}</h3>
      <div className="tir-block">
        <Fit className="tir-fit tall">{({ w, h }) => <TirBar W={w} H={h} labels={false} />}</Fit>
        <ul className="tir-legend goals">
          {bands().map((b) => (
            <li key={b.key} className={b.key === 'in' ? 'in' : ''}><span className="sw" style={{ background: b.fill }} /><span>{b.label}</span><span className="num">{b.pct}%</span><span className="caption">goal {goals[b.key] ?? ''}</span></li>
          ))}
        </ul>
      </div>
      {READ.inRangeSinceLastVisit != null && <p className="caption">{terms.tir} {READ.inRangeSinceLastVisit >= 0 ? 'up' : 'down'} {Math.abs(READ.inRangeSinceLastVisit)} points on the {PERIOD.days} days before.</p>}
    </section>
  );
}

function TldrBlock({ onEvidence }: { onEvidence?: (section: string) => void }) {
  return (
    <section className="panel" aria-labelledby="tldr-h">
      <h3 id="tldr-h" className="label">Visit TLDR · where your input helps most</h3>
      <ul className="tldr">
        {tldrLines().map((l) => (
          <li key={l.key}>
            <span className="strong">{l.title}</span>
            <span className="small ink">{l.text}</span>
            {l.section !== 'glucose' && onEvidence && (
              <button type="button" className="text-btn" onClick={() => onEvidence(l.section)} aria-label={`Evidence for ${l.title}`}>
                Evidence <IChevron />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The pattern worth looking at first: the weekday stretch that passed the heads-up bar. */
function PatternsBlock() {
  return (
    <section className="panel stack-8" aria-labelledby="pat-h">
      <h3 id="pat-h" className="label">Patterns · highest priority first</h3>
      {HEADS_UP ? (
        <div className="pattern-row">
          <span className={`flag${HEADS_UP.kind === 'low' ? ' dose' : ''}`}>{HEADS_UP.kind === 'low' ? 'Low pattern' : 'High pattern'}</span>
          <div className="stack-4">
            <span className="strong">{HEADS_UP.title}</span>
            <span className="small ink">{TEXT.pattern}</span>
            <span className="caption">{HEADS_UP.detail}</span>
          </div>
        </div>
      ) : <p className="small">No weekday stretch passed the 10% bar in this period. {TEXT.pattern}</p>}
    </section>
  );
}

function DailyBlock() {
  return (
    <section className="panel stack-8" aria-labelledby="daily-h">
      <div className="row between baseline">
        <h3 id="daily-h" className="label">Daily glucose · day by day</h3>
        <span className="caption">{DAILY.days.filter((d) => d.usable).length} of {DAILY.days.length} days counted</span>
      </div>
      <Fit className="chart-md">{({ w, h }) => <DailyChart days={DAILY.days} today={null} W={w} H={h} band={STANDARD} />}</Fit>
      <span className="caption">Dot: the day’s average · bar: its middle half · line: 5–95% · 70–180 mg/dL shaded</span>
    </section>
  );
}

// ------------------------------------------------------------ insulin and Loop

function InsulinBlock({ terms }: { terms: Terms }) {
  return (
    <section className="panel" aria-labelledby="ins-h">
      <h3 id="ins-h" className="label">{terms.insulinTitle} · {USABLE_N} usable days</h3>
      <div className="ins-row">
        <div className="stat"><b>{READ.automationPct}%</b><span>{terms.automation.toLowerCase()}</span><span className="caption">gaps: {READ.automationGaps}</span></div>
        <div className="stat">
          <b>{INSULIN.algorithmPct}% · {INSULIN.userPct}%</b>
          <span>{terms.algorithm} · {terms.user}</span>
          <svg className="split" viewBox="0 0 200 10" width="100%" height="10" role="img" aria-label={`Of ${INSULIN.totalDailyU} U a day, ${INSULIN.algorithmPct}% was ${terms.algorithm} and ${INSULIN.userPct}% ${terms.user}.`} preserveAspectRatio="none">
            <rect x="0" y="0" width={INSULIN.algorithmPct * 2} height="10" rx="2" style={{ fill: 'var(--graph-insulin)' }} />
            <rect x={INSULIN.algorithmPct * 2 + 1} y="0" width={Math.max(0, INSULIN.userPct * 2 - 1)} height="10" rx="2" style={{ fill: 'var(--graph-insulin-soft)', stroke: 'var(--graph-insulin)' }} strokeWidth="0.8" />
          </svg>
        </div>
        <div className="stat"><b>{INSULIN.totalDailyU} U</b><span>{terms.tdi}</span><span className="caption">presets: {INSULIN.presets}</span></div>
      </div>
      <p className="small ink">{TEXT.loopFinding} A plain statement of what Loop did; the settings in force are in the timeline.</p>
    </section>
  );
}

// ------------------------------------------------------------ changes

export function ChangeTimeline({ side }: { side: 'patient' | 'clinician' }) {
  const steps = (c: SettingsChange) => [
    { k: 'Proposed', who: c.proposedBy === PATIENT.first && side === 'patient' ? 'You' : c.proposedBy, done: true },
    { k: 'Agreed', who: c.agreedBy === PATIENT.first && side === 'patient' ? 'You' : c.agreedBy, done: Boolean(c.agreedBy) },
    { k: 'Applied in Loop', who: c.appliedBy?.replace(`${PATIENT.first}, in Loop`, side === 'patient' ? 'You, in Loop' : `${PATIENT.first}, in Loop`) ?? null, done: Boolean(c.appliedBy) },
    { k: 'Review', who: c.reviewDate, done: c.status === 'reviewed' },
  ];
  return (
    <ol className="timeline" aria-label="Settings changes, newest first">
      {CHANGES.map((c) => (
        <li key={c.id} className={`change ${c.status}`}>
          <div className="when"><b>{c.date}</b></div>
          <div className="stack-8">
            <span className="strong">{c.setting}: {c.from} → {c.to}</span>
            <ol className="steps" aria-label={`${c.setting} progress`}>
              {steps(c).map((s) => (
                <li key={s.k} className={s.done ? 'done' : ''}>
                  <span className="dot" aria-hidden="true" />
                  <span className="caption"><span className="strong">{s.k}</span>{s.who ? ` · ${s.who}` : ' · waiting'}{s.done ? '' : ' (not yet)'}</span>
                </li>
              ))}
            </ol>
            <span className="caption">{c.note}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineBlock() {
  return (
    <section className="panel" aria-labelledby="tl-h">
      <h3 id="tl-h" className="label">Settings timeline · who proposed, who agreed, when to review</h3>
      <ChangeTimeline side="clinician" />
    </section>
  );
}

/** This period against the one before: the read's headline numbers side by side. */
function CompareBlock({ terms }: { terms: Terms }) {
  const d = READ.inRangeSinceLastVisit;
  return (
    <section className="panel stack-8" aria-labelledby="cmp-h">
      <h3 id="cmp-h" className="label">{terms.compareTitle}</h3>
      <dl className="stat-tiles">
        <div className="stat-tile"><dt className="caption">{terms.tir}, this period</dt><dd><b className="read-num">{READ.inRangePct}</b><span className="small"> %</span></dd></div>
        <div className="stat-tile"><dt className="caption">{terms.tir}, the {PERIOD.days} days before</dt><dd><b className="read-num">{d == null ? '—' : +(READ.inRangePct - d).toFixed(1)}</b><span className="small">{d == null ? '' : ' %'}</span></dd></div>
        <div className="stat-tile"><dt className="caption">Change</dt><dd><b className="read-num">{d == null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d)}`}</b><span className="small">{d == null ? '' : ' points'}</span></dd></div>
      </dl>
      <p className="caption">What happened between the two periods, not why. Settings changes are in the timeline.</p>
    </section>
  );
}

function BeforeAfterBlock() {
  return (
    <section className="panel stack-12" aria-labelledby="ba-h">
      <div className="row between baseline">
        <h3 id="ba-h" className="label">Before and after · carb ratio, lunch</h3>
        <span className="caption">{LUNCH.usable.days} days each side, {LUNCH.usable.after} usable{CHANGES.some((c) => c.status === 'applied' || c.status === 'reviewed') ? ' · change day left out' : ''}</span>
      </div>
      <BaChart className="chart-md" />
      <BaLegend />
      <p className="small ink">{TEXT.lunchFinding} What happened after, not proof of why.</p>
    </section>
  );
}

// ------------------------------------------------------------ trends

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const one = (x: number | null) => (x == null ? '—' : `${+x.toFixed(1)}`);

/** Counted days split into the first and second half of the period. Pure, for testing. */
export function halves(days: readonly DailyGlucose[]) {
  const used = days.filter((d) => d.usable);
  const mid = Math.ceil(used.length / 2);
  const sum = (ds: DailyGlucose[]) => ({ n: ds.length, tir: avg(ds.map((d) => d.std?.inRangePct ?? null)), below: avg(ds.map((d) => d.std?.belowPct ?? null)), above: avg(ds.map((d) => d.std?.abovePct ?? null)), mean: avg(ds.map((d) => d.meanMgdl)) });
  return { first: sum(used.slice(0, mid)), second: sum(used.slice(mid)) };
}

/** Each day as one 100% bar: below 70 at the bottom, in range, above 180 on top. Days not counted are outlined, not drawn (VIS-4). */
function DailyRangeBars({ days, W, H }: { days: readonly DailyGlucose[]; W: number; H: number }) {
  const B = 18;
  const ph = H - B;
  const slot = W / Math.max(1, days.length);
  const bw = Math.min(22, slot * 0.64);
  const every = slot < 34 ? 2 : 1;
  const label = `Time in range by day, ${days.length} days: ${days.map((d) => (d.usable && d.std ? `${d.label} ${Math.round(d.std.inRangePct)}% in range` : `${d.label} not counted`)).join('; ')}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      {days.map((d, i) => {
        const x = i * slot + (slot - bw) / 2;
        const lo = d.std?.belowPct ?? 0, hi = d.std?.abovePct ?? 0, inr = d.std?.inRangePct ?? 0;
        const tot = lo + hi + inr || 1;
        const hLo = (lo / tot) * ph, hIn = (inr / tot) * ph, hHi = (hi / tot) * ph;
        return (
          <g key={d.day}>
            {d.usable && d.inRangePct != null ? (
              <>
                <rect x={x} y={0} width={bw} height={Math.max(0, hHi - 1)} rx="2" style={{ fill: 'var(--range-high)' }} />
                <rect x={x} y={hHi} width={bw} height={Math.max(0, hIn - 1)} rx="2" style={{ fill: 'var(--range-in)' }} />
                <rect x={x} y={hHi + hIn} width={bw} height={Math.max(0, hLo)} rx="2" style={{ fill: 'var(--range-low)' }} />
              </>
            ) : <rect x={x + 0.5} y={0.5} width={bw - 1} height={ph - 1} rx="2" fill="none" strokeDasharray="3 3" style={{ stroke: 'var(--ink-300)' }} />}
            {i % every === 0 && <text x={x + bw / 2} y={H - 4} fontSize="11" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{d.day.split(' ')[1] ?? d.day}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function TrendsBlock({ terms }: { terms: Terms }) {
  const { first, second } = halves(DAILY.days);
  const rows: { k: string; a: number | null; b: number | null; unit: string }[] = [
    { k: terms.tir, a: first.tir, b: second.tir, unit: '%' },
    { k: 'Below 70', a: first.below, b: second.below, unit: '%' },
    { k: 'Above 180', a: first.above, b: second.above, unit: '%' },
    { k: `Glucose ${terms.mean}`, a: first.mean, b: second.mean, unit: ' mg/dL' },
  ];
  const delta = (a: number | null, b: number | null, unit: string) => {
    if (a == null || b == null) return '—';
    const d = +(b - a).toFixed(1);
    return `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}${unit === '%' ? ' points' : unit}`;
  };
  return (
    <section className="panel stack-12" aria-labelledby="trend-h">
      <div className="row between baseline">
        <h3 id="trend-h" className="label">Trends · {PERIOD.days} days, day by day</h3>
        <span className="caption">{first.n + second.n} of {DAILY.days.length} days counted</span>
      </div>
      <Fit className="chart-sm">{({ w, h }) => <DailyRangeBars days={DAILY.days} W={w} H={h} />}</Fit>
      <ul className="tir-legend trend-legend">
        <li><span className="sw" style={{ background: 'var(--range-high)' }} /><span>Above 180</span></li>
        <li className="in"><span className="sw" style={{ background: 'var(--range-in)' }} /><span>{terms.tir}</span></li>
        <li><span className="sw" style={{ background: 'var(--range-low)' }} /><span>Below 70</span></li>
        <li><span className="sw outline" /><span>Not counted</span></li>
      </ul>
      <table className="trend-table">
        <caption className="sr-only">First half of the period against the second half</caption>
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th><th scope="col" className="caption">First {first.n} days</th><th scope="col" className="caption">Last {second.n} days</th><th scope="col" className="caption">Change</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}><th scope="row" className="small">{r.k}</th><td className="num">{one(r.a)}{r.a == null ? '' : r.unit}</td><td className="num">{one(r.b)}{r.b == null ? '' : r.unit}</td><td className="num strong">{delta(r.a, r.b, r.unit)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="caption">How the period moved, not why. Days averaged as they come; settings changes are in the timeline.</p>
    </section>
  );
}

// ------------------------------------------------------------ the person's notes

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function NoteList({ notes }: { notes: CareNote[] }) {
  return (
    <ol className="care-notes">
      {notes.map((n) => (
        <li key={n.id}><div className="stack-4" style={{ minWidth: 0 }}><span className="caption">{n.date}</span><span className="small ink">{n.text}</span></div></li>
      ))}
    </ol>
  );
}

/** Notes the person kept for the care team, since the visit last marked done. Kept on this Mac. */
function NotesBlock({ go }: { go: Go }) {
  const [notes] = useCareNotes();
  const [lastVisit, setLastVisit] = useLastVisit();
  const announce = useAnnounce();
  const { since, before } = splitAtVisit(notes, lastVisit);
  const write = () => { openCareNotes(); go({ view: 'dashboard', tile: 'care-thread' }); };
  return (
    <section className="panel stack-12" aria-labelledby="notes-r-h">
      <div className="row between baseline wrap">
        <h3 id="notes-r-h" className="label">Notes since the last visit · {since.length}</h3>
        <span className="caption">{lastVisit == null ? 'No visit marked yet: every note shows' : `Last visit marked ${fmtDay(lastVisit)}`}</span>
      </div>
      {since.length
        ? <NoteList notes={since} />
        : <p className="small">{lastVisit == null ? 'No notes yet.' : 'Nothing noted since the last visit.'} Notes are kept on this Mac from the care-team tile.</p>}
      <div className="row wrap">
        <button type="button" className="quiet-btn" onClick={write}>{since.length ? 'Add a note' : 'Write a note'}</button>
        {since.length > 0 && <button type="button" className="text-btn" onClick={() => { setLastVisit(Date.now()); announce(`Visit marked done. ${since.length} note${since.length === 1 ? '' : 's'} moved to earlier notes.`); }}>Mark this visit done</button>}
        {lastVisit != null && since.length === 0 && <button type="button" className="text-btn" onClick={() => { setLastVisit(null); announce('Visit mark removed. Every note shows again.'); }}>Undo the visit mark</button>}
      </div>
      {before.length > 0 && (
        <details className="earlier-notes">
          <summary className="caption strong">Earlier notes · {before.length}</summary>
          <NoteList notes={before} />
        </details>
      )}
    </section>
  );
}
