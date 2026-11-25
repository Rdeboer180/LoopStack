// Glance: the period's TLDR, one component for the phone home and the desktop
// dashboard (the board's consensus, Nov 23; design canvas "LoopStack top bar").
// Each app builds a GlanceViewModel from its own data; this draws it. Styles:
// src/styles/glance.css (tokens only). Seven tiles in one grid that reflows
// 6 → 4 → 2 columns with its own width.
//
// The full state set (board pass, Nov 23):
//   loading      skeletons that keep each tile's shape (1.4s shimmer), the header
//                says what is being read; then tiles reveal 40ms apart over 400ms
//                and numbers count up over 600ms
//   refreshing   values stay, dimmed, under a 2px progress line; when the read
//                lands, only the numbers that changed flash once (1.2s) and a
//                polite live region says it updated
//   period       numbers tween in place from their old value; nothing blanks
//   stale        over 15 minutes: the number greys, the arrow goes, a chip says how old
//   error        last values stay under a banner with the reason and Try again; never zeros
//   empty        one calm card with the reason and the way to connect
//   partial      a dash and "Not enough readings" on that tile only
//   sample       the header says so and offers to connect
//   pointer      hover hairline, press 0.99, a title naming what the tile opens
//   touch        press state only; every tile well over 44px
//   keyboard     tiles are buttons in reading order, green focus ring, Enter/Space opens;
//                the accessible name carries the value and where it goes
//   reduced motion  every change instant
// Observations only (SAFE-1). Data on solid ground (GLASS-1). No basal/bolus ratio (DATA-1/2).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import '@/styles/glance.css';

export type GlanceKey = 'g' | 't' | 'a' | 'i' | 'w' | 'l' | 'd';
export type GlanceState = 'loading' | 'refreshing' | 'ready';
/** Reading order: the order tiles reveal in and the order Tab visits them. */
const ORDER: readonly GlanceKey[] = ['g', 't', 'a', 'i', 'w', 'l', 'd'];
type Pts = readonly (readonly [number, number])[];

export interface GlanceCell { value: number | null; digits?: number; unit?: string; label: string }
export interface GlanceViewModel {
  periodLabel: string;
  headline: string;
  headsUp: string | null;
  band: { low: number; high: number };
  now: {
    mgdl: number | null; arrow: string; trendLabel: string; status: string;
    tone: 'low' | 'high' | 'in' | 'stale'; stale: boolean; ageMin: number; ageText: string;
    /** One line under the chart: active insulin and carbs, or what the source has. */
    foot: string;
    points: Pts; prediction: Pts;
  };
  tir: { pct: number | null; urgent: number; low: number; high: number; veryHigh: number; range: string; delta: number | null };
  avg: { mgdl: number | null; gmi: number | null; cv: number | null };
  insulin: { cells: readonly [GlanceCell, GlanceCell, GlanceCell]; foot: string };
  week: readonly { label: string; pct: number | null; today: boolean; dot: string }[];
  /** One line over the rings: the day that stands out, or that none does. */
  weekNote: string;
  /** Time below your low, as a percent of readings, with how it moved across the period. */
  lows: {
    value: number | null; digits?: number; unit?: string; caption: string;
    /** Percent below in each stretch of the period, oldest first; empty when there's too little to split. */
    trend?: readonly (number | null)[];
    /** "Down from 4.1% early in the period". */
    trendNote?: string;
  };
  side: { title: string; icon: 'device' | 'activity'; rows: readonly { label: string; value: string; frac: number | null }[] };
}

export interface GlanceViewProps {
  model: GlanceViewModel | null;
  state: GlanceState;
  /** What the header says while loading: "Reading your Nightscout…". */
  loadingText: string;
  /** Under the headline: where the numbers come from. */
  sourceLine: ReactNode;
  /** A failed read: its reason. The last values stay. */
  error?: string | null;
  errorTitle?: string;
  onRetry?: () => void;
  /** Shown as Read again when given. */
  onRefresh?: () => void;
  /** What each tile opens, for its title and accessible name. */
  opens: Record<GlanceKey, string>;
  onOpen: (k: GlanceKey) => void;
  /** With no model and not loading: why there's nothing, and what to do. */
  empty?: { reason: string; action?: ReactNode };
}

const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up on first show, tweens from what's on screen after, and can flash once when it changes. */
function Count({ value, digits = 0, flash = false }: { value: number | null; digits?: number; flash?: boolean }) {
  const target = value ?? 0;
  const reduce = reduceMotion();
  const [shown, setShown] = useState(reduce ? target : 0);
  const last = useRef(reduce ? target : 0);
  last.current = shown;
  const prev = useRef<number | null>(value);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (flash && prev.current != null && value != null && prev.current.toFixed(digits) !== value.toFixed(digits)) setPulse((p) => p + 1);
    prev.current = value;
  }, [value, flash, digits]);
  useEffect(() => {
    if (reduce || value == null) { setShown(target); return undefined; }
    const from = last.current;
    const t0 = performance.now();
    const ms = from === 0 ? 600 : 400;
    const ease = (x: number) => 1 - Math.pow(1 - x, 5);
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setShown(from + (target - from) * ease(p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce, value]);
  if (value == null) return <>—</>;
  return <span key={pulse} className={pulse ? 'gl-flash' : undefined}><span aria-hidden="true">{shown.toFixed(digits)}</span><span className="gl-sr">{target.toFixed(digits)}</span></span>;
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS: Record<GlanceKey | 'activity' | 'bell' | 'refresh', ReactNode> = {
  g: <Icon><path d="M10 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" /></Icon>,
  t: <Icon><circle cx="10" cy="10" r="6.5" /><path d="M10 6v4l2.5 2" /></Icon>,
  a: <Icon><path d="M3 14l4-4 3 3 7-7" /></Icon>,
  i: <Icon><path d="M13 3l4 4M15 5l-8 8-3 1 1-3 8-8" /></Icon>,
  w: <Icon><rect x="3.5" y="4.5" width="13" height="12" rx="2" /><path d="M3.5 8.5h13M7 3v3M13 3v3" /></Icon>,
  l: <Icon><path d="M10 4v10M6 10l4 4 4-4" /></Icon>,
  d: <Icon><rect x="5" y="4" width="10" height="12" rx="3" /><path d="M8 8h4" /></Icon>,
  activity: <Icon><path d="M3 10h3l2-5 4 10 2-5h3" /></Icon>,
  bell: <Icon><path d="M10 4a4 4 0 0 0-4 4v3l-1.5 2.5h11L14 11V8a4 4 0 0 0-4-4z" /><path d="M8.5 16a1.6 1.6 0 0 0 3 0" /></Icon>,
  refresh: <Icon><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16 3.5v3h-3" /></Icon>,
};

/** One ring per day, the phone's "Last 7 days" treatment: the percent inside, the colour from it, today's track dashed (it's partial). */
function DayRing({ d, i }: { d: GlanceViewModel['week'][number]; i: number }) {
  const R = 13, C = 2 * Math.PI * R;
  const v = d.pct == null ? 0 : Math.max(0, Math.min(100, d.pct));
  return (
    <span className={`gl-ring${d.today ? ' today' : ''}${d.pct == null ? ' missing' : ''}`} style={{ ['--i' as string]: i }} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={R} className="gl-ring-track" />
        {d.pct != null && v > 0 && <circle cx="16" cy="16" r={R} className="gl-ring-arc" style={{ stroke: d.dot, ['--len' as string]: (C * v) / 100, ['--c' as string]: C }} transform="rotate(-90 16 16)" />}
        <text x="16" y="19.5" textAnchor="middle" className="gl-ring-num">{d.pct == null ? '·' : d.pct}</text>
      </svg>
      <span className="gl-ring-label">{d.label}</span>
    </span>
  );
}

/** Percent of readings below your low in each stretch of the period, oldest first. Height is the share; a gap is a stretch with no readings. */
function LowBars({ values }: { values: readonly (number | null)[] }) {
  const max = Math.max(4, ...values.map((v) => v ?? 0));
  return (
    <span className="gl-lowbars" aria-hidden="true">
      {values.map((v, i) => <span key={i} className={v == null ? 'none' : ''} style={{ height: v == null ? undefined : `${Math.max(6, (v / max) * 100)}%` }} />)}
    </span>
  );
}

const Sk = ({ w, h, r }: { w: string; h: number; r?: number }) => <span className="gl-sk" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;

function Spark({ m, band }: { m: GlanceViewModel['now']; band: GlanceViewModel['band'] }) {
  if (m.points.length < 2) return <span className="gl-spark empty"><span className="caption">Not enough readings to draw</span></span>;
  const pts = [...m.points, ...m.prediction];
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const lo = Math.min(40, ...pts.map((p) => p[1])), hi = Math.max(220, ...pts.map((p) => p[1]));
  const X = (h: number) => ((h - x0) / Math.max(0.01, x1 - x0)) * 340;
  const Y = (g: number) => 6 + ((hi - g) / (hi - lo)) * 88;
  const path = (ps: Pts) => `M${ps.map(([h, g]) => `${X(h).toFixed(1)} ${Y(g).toFixed(1)}`).join(' L')}`;
  const last = m.points[m.points.length - 1];
  return (
    <svg className="gl-spark" viewBox="0 0 340 100" preserveAspectRatio="none" role="img" aria-label={`Glucose over the last few hours, ${m.mgdl ?? 'no reading'} mg/dL now; ${band.low} to ${band.high} shaded${m.prediction.length ? ', Loop’s prediction dashed' : ''}.`}>
      <rect x="0" y={Y(band.high)} width="340" height={Y(band.low) - Y(band.high)} className="gl-band" />
      <path d={path(m.points)} className={`gl-line${m.stale ? ' stale' : ''}`} vectorEffect="non-scaling-stroke" />
      {m.prediction.length > 0 && <path d={path([last, ...m.prediction])} className="gl-pred" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function Tile({ k, title, period, named, opens, onOpen, chip, children }: { k: GlanceKey; title: string; period?: string; named: string; opens: string; onOpen: (k: GlanceKey) => void; chip: ReactNode; children: ReactNode }) {
  return (
    <button type="button" className={`gl-tile gl-${k}`} style={{ ['--i' as string]: ORDER.indexOf(k) }}
      onClick={() => onOpen(k)} title={`Open ${opens}`} aria-label={`${named}. Opens ${opens}.`}>
      <span className="gl-top" aria-hidden="true">
        <span className="gl-lab">{title}{period ? <span className="gl-period"> · {period}</span> : null}</span>
        <span className={`gl-chip c-${k}`}>{chip}</span>
      </span>
      {children}
    </button>
  );
}

function SkeletonTile({ k, children }: { k: GlanceKey; children: ReactNode }) {
  return (
    <div className={`gl-tile gl-${k} gl-skeleton`} aria-hidden="true">
      <span className="gl-top"><Sk w="90px" h={12} /><Sk w="30px" h={30} r={15} /></span>
      {children}
    </div>
  );
}

export function GlanceView({ model: m, state, loadingText, sourceLine, error, errorTitle = 'Couldn’t read your data.', onRetry, onRefresh, opens, onOpen, empty }: GlanceViewProps) {
  const loading = state === 'loading';
  const refreshing = state === 'refreshing';
  // Numbers flash only when a read lands, not when the period changes.
  const wasRefreshing = useRef(false);
  const [landed, setLanded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (wasRefreshing.current && state === 'ready' && !error) {
      setLanded(true);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      const t = setTimeout(() => setLanded(false), 1300);
      wasRefreshing.current = false;
      return () => clearTimeout(t);
    }
    wasRefreshing.current = refreshing;
    return undefined;
  }, [state, refreshing, error]);

  if (!m && !loading) {
    return (
      <section className="glance gl-empty" aria-label="Your period at a glance">
        <h2 className="gl-h">No readings yet</h2>
        <p className="caption">{empty?.reason ?? 'Nothing to show for this period.'}</p>
        {empty?.action}
      </section>
    );
  }

  return (
    <section className={`glance${refreshing ? ' dim' : ''}${loading ? ' loading' : ''}`} aria-label="Your period at a glance" aria-busy={loading || refreshing || undefined}>
      <div className="gl-progress" aria-hidden="true">{(loading || refreshing) && <span />}</div>
      <span className="gl-sr" aria-live="polite">{loading ? loadingText : refreshing ? 'Reading again…' : updatedAt ? `Updated ${updatedAt}.` : ''}</span>

      <header className="gl-head">
        <div className="gl-title">
          {loading || !m ? (
            <><Sk w="min(320px, 80%)" h={24} /><span className="caption">{loadingText}</span></>
          ) : (
            <>
              <h2 className="gl-h">{m.headline}</h2>
              <span className="caption gl-sub">
                {m.headsUp && <><span className="gl-bell">{ICONS.bell}</span>{m.headsUp} · </>}
                {sourceLine}
              </span>
            </>
          )}
        </div>
        {onRefresh && (
          <button type="button" className="gl-btn" onClick={onRefresh} disabled={loading || refreshing}>
            {ICONS.refresh}{refreshing ? 'Reading…' : 'Read again'}
          </button>
        )}
      </header>

      {error && (
        <div className="gl-error" role="alert">
          <span><b className="strong">{errorTitle}</b> The numbers below are from the last read, kept as they were. {error}</span>
          {onRetry && <button type="button" className="gl-btn" onClick={onRetry}>Try again</button>}
        </div>
      )}

      {loading || !m ? (
        <div className="gl-grid">
          <SkeletonTile k="g"><span className="gl-skc"><Sk w="190px" h={70} r={14} /><Sk w="150px" h={14} /><Sk w="100%" h={124} r={16} /></span></SkeletonTile>
          <SkeletonTile k="t"><span className="gl-skc end"><Sk w="90px" h={34} /><Sk w="100%" h={8} /><Sk w="110px" h={12} /></span></SkeletonTile>
          <SkeletonTile k="a"><span className="gl-skc end"><Sk w="100px" h={34} /><Sk w="130px" h={12} /></span></SkeletonTile>
          <SkeletonTile k="i"><span className="gl-skc"><span className="gl-three"><Sk w="100%" h={64} r={14} /><Sk w="100%" h={64} r={14} /><Sk w="100%" h={64} r={14} /></span><Sk w="170px" h={12} /></span></SkeletonTile>
          <SkeletonTile k="w"><span className="gl-skc"><Sk w="160px" h={12} /><span className="gl-rings">{Array.from({ length: 8 }, (_, j) => <Sk key={j} w="100%" h={44} r={22} />)}</span></span></SkeletonTile>
          <SkeletonTile k="l"><span className="gl-skc end"><Sk w="40px" h={34} /><Sk w="120px" h={12} /></span></SkeletonTile>
          <SkeletonTile k="d"><span className="gl-skc end"><Sk w="100%" h={12} /><Sk w="100%" h={5} /><Sk w="100%" h={12} /><Sk w="100%" h={5} /></span></SkeletonTile>
        </div>
      ) : (
        <div className="gl-grid">
          <Tile k="g" title={m.now.mgdl == null ? 'Now' : `Now · ${m.now.ageText}`} named={m.now.mgdl == null ? 'Glucose now: no reading' : `Glucose now ${m.now.mgdl} mg/dL, ${m.now.status}`} opens={opens.g} onOpen={onOpen} chip={ICONS.g}>
            <span className={`gl-now tone-${m.now.tone}`}>
              <span className="gl-now-num"><Count value={m.now.mgdl} flash={landed} /></span>
              {m.now.arrow && <span className="gl-arrow">{m.now.arrow}</span>}
              <span className="caption">mg/dL</span>
              {m.now.stale && <span className="gl-age">{m.now.ageMin} min old</span>}
            </span>
            <span className="gl-status"><span className={`gl-dot tone-${m.now.tone}`} />{m.now.status}</span>
            <span className="gl-inset"><Spark m={m.now} band={m.band} /></span>
            <span className="caption">{m.now.foot}</span>
          </Tile>

          <Tile k="t" title="In range" period={m.periodLabel} named={m.tir.pct == null ? 'Time in range: not enough readings' : `Time in range ${Math.round(m.tir.pct)}%`} opens={opens.t} onOpen={onOpen} chip={ICONS.t}>
            <span className="gl-big">{m.tir.pct == null ? '—' : <><Count value={m.tir.pct} digits={m.tir.pct % 1 ? 1 : 0} flash={landed} />%</>}</span>
            {m.tir.pct == null ? <span className="caption">Not enough readings</span> : (
              <>
                <span className="gl-bands">
                  <span style={{ width: `${m.tir.urgent}%`, background: 'var(--range-very-low)' }} />
                  <span style={{ width: `${m.tir.low}%`, background: 'var(--range-low)' }} />
                  <span style={{ width: `${m.tir.pct}%`, background: 'var(--range-in)' }} />
                  <span style={{ width: `${m.tir.high}%`, background: 'var(--range-high)' }} />
                  <span style={{ width: `${m.tir.veryHigh}%`, background: 'var(--range-very-high)' }} />
                </span>
                <span className="caption">{m.tir.range}{m.tir.delta != null && m.tir.delta !== 0 ? ` · ${m.tir.delta > 0 ? '↑' : '↓'}${Math.abs(m.tir.delta)} vs before` : ''}</span>
              </>
            )}
          </Tile>

          <Tile k="a" title="Average" period={m.periodLabel} named={m.avg.mgdl == null ? 'Average: not enough readings' : `Average ${m.avg.mgdl} mg/dL, estimated A1C ${m.avg.gmi ?? 'unknown'}%`} opens={opens.a} onOpen={onOpen} chip={ICONS.a}>
            <span className="gl-big">{m.avg.mgdl == null ? '—' : <Count value={m.avg.mgdl} flash={landed} />} <span className="caption">mg/dL</span></span>
            <span className="caption">{m.avg.mgdl == null ? 'Not enough readings' : <>Est. A1C <b className="strong">{m.avg.gmi == null ? '—' : <><Count value={m.avg.gmi} digits={1} />%</>}</b> · CV <b className="strong">{m.avg.cv == null ? '—' : <><Count value={m.avg.cv} />%</>}</b></>}</span>
          </Tile>

          <Tile k="i" title="Insulin a day" period={m.periodLabel} named={`Insulin a day: ${m.insulin.cells.map((c) => `${c.label} ${c.value == null ? 'unknown' : `${c.value}${c.unit ?? ''}`}`).join(', ')}`} opens={opens.i} onOpen={onOpen} chip={ICONS.i}>
            <span className="gl-three">
              {m.insulin.cells.map((c) => (
                <span key={c.label} className="gl-cell"><b>{c.value == null ? '—' : <><Count value={c.value} digits={c.digits} flash={landed} />{c.unit}</>}</b><span className="caption">{c.label}</span></span>
              ))}
            </span>
            <span className="caption">{m.insulin.foot}</span>
          </Tile>

          <Tile k="w" title="In range by day" named={`In range by day. ${m.weekNote} ${m.week.map((d) => `${d.today ? 'today so far' : d.label} ${d.pct == null ? 'not counted' : `${d.pct}%`}`).join(', ')}`} opens={opens.w} onOpen={onOpen} chip={ICONS.w}>
            <span className="gl-weeknote">{m.weekNote}</span>
            <span className="gl-rings" style={{ ['--n' as string]: Math.max(1, m.week.length) }}>
              {m.week.map((d, j) => <DayRing key={j} d={d} i={j} />)}
            </span>
          </Tile>

          <Tile k="l" title="Low trend" period={m.periodLabel} named={`Low trend: ${m.lows.value ?? 'unknown'}${m.lows.unit ?? ''} ${m.lows.caption}. ${m.lows.trendNote ?? ''}`} opens={opens.l} onOpen={onOpen} chip={ICONS.l}>
            <span className="gl-big">{m.lows.value == null ? '—' : <><Count value={m.lows.value} digits={m.lows.digits} flash={landed} />{m.lows.unit}</>}</span>
            <span className="caption">{m.lows.caption}</span>
            {m.lows.trend && m.lows.trend.length > 1 && <LowBars values={m.lows.trend} />}
            {m.lows.trendNote && <span className="caption">{m.lows.trendNote}</span>}
          </Tile>

          <Tile k="d" title={m.side.title} named={`${m.side.title}: ${m.side.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`} opens={opens.d} onOpen={onOpen} chip={m.side.icon === 'activity' ? ICONS.activity : ICONS.d}>
            <span className="gl-devices">
              {m.side.rows.map((r) => (
                <span key={r.label} className="gl-dev">
                  <span className="gl-devrow"><span>{r.label}</span><b>{r.value || '—'}</b></span>
                  {r.frac != null && <span className="gl-meter"><span style={{ width: `${Math.round(Math.min(1, Math.max(0, r.frac)) * 100)}%` }} /></span>}
                </span>
              ))}
            </span>
          </Tile>
        </div>
      )}
    </section>
  );
}
