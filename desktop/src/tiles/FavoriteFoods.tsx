// Favorite foods: a ledger of the meals the person eats again and again. Each
// favorite is a row to navigate; picking one shows every time it was eaten,
// with how it went (stayed in your band, went above it, went below it) and the
// absorption time Loop was given (entered) against how long Loop took to absorb
// it (its own carb count, so it matches the Loop app; carbAbsorbed.ts), with when
// the glucose rise landed shown apart. Sorted by recent (default), most
// eaten or most often out of range. Unnamed carb entries are left out: a
// ledger needs a name to line repeats up.
// Observations only (SAFE-1, SAFE-2): what happened after each meal, never
// what to enter. The one action is adding a favorite to the person's own Loop
// build, which goes through SAFE-3 in LoopFavorites.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DATA, MEALS, SUGGESTIONS } from '../data/current';
import { foodId } from '../data/suggestions';
import type { Confidence } from '@/lib/metabolism/autotune';
import { useTracked } from '../data/tracked';
import { favoritesBridge } from '../data/favorites';
import { openFood, takeFood } from '../data/intent';
import { BANDS, rangeText } from '../data/ranges';
import { curveBands, dur, WINDOW_MIN, type CurveBand, type MealGroup, type MealOutcome, type MealResponse } from '../data/meals';
import { Fit, IChevron, IPlus, Segmented, TileSelect, useAnnounce } from '../ui/kit';
import { NoteButton } from '../ui/NoteComposer';
import { mealAnchor, mealSnapshot } from '../data/noteAnchors';
import { LoopFavorites } from './AddFavorite';
import type { FaceProps } from './faces';
import './favoritefoods.css';
import { WD, WD_SHORT, weekdayRows, weekdayTrend, type WeekdayHours } from '../data/mealWeekday';

/** How a weekday's hours run on any food, from the weekday grid (the same one Weekday by hour reads). */
const gridHours: WeekdayHours = (wd, h) => { const c = DATA.WEEKDAY_GRID.days[wd]?.hours[h]; return c ? { lowPct: c.lowPct, highPct: c.highPct } : null; };

/**
 * A food by day of the week: every time it was eaten, sorted onto the weekday it fell on, and one
 * note on whether a trend follows the food, the food on one weekday, or the weekday on any food.
 * Reads all the times (a weekday split of the last 3 would say nothing). Observations only (SAFE-1).
 */
function ByWeekday({ meals, name }: { meals: readonly MealResponse[]; name: string }) {
  const rows = weekdayRows(meals);
  const trend = weekdayTrend(meals, gridHours, BANDS, name.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || 'this food');
  const words = (r: (typeof rows)[number]) => [r.low ? `${r.low} low` : '', r.high ? `${r.high} high` : '', r.inRange ? `${r.inRange} in range` : ''].filter(Boolean).join(' · ');
  return (
    <section className="ff-weekday" aria-label="By day of the week">
      <div className="row between wrap"><span className="ff-weekday-h">By day of the week</span><span className="caption">all {meals.length} {meals.length === 1 ? 'time' : 'times'}</span></div>
      <ol className="ff-wd-row">
        {rows.map((r) => (
          <li key={r.weekday} className={`ff-wd${r.n === 0 ? ' empty' : ''}${trend.weekday === r.weekday ? ` stand ${trend.side ?? ''}` : ''}`} aria-label={`${WD[r.weekday]}: ${r.n === 0 ? 'not eaten' : `${r.n} ${r.n === 1 ? 'time' : 'times'}, ${words(r)}`}`}>
            <span className="ff-wd-day" aria-hidden="true">{WD_SHORT[r.weekday]}</span>
            <b aria-hidden="true">{r.n || '–'}</b>
            <span className="ff-wd-marks" aria-hidden="true">
              {Array.from({ length: Math.min(r.n, 6) }, (_, i) => {
                const k = i < r.low ? 'low' : i < r.low + r.high ? 'high' : 'in';
                return <i key={i} className={`ff-wd-mark ${k}`} />;
              })}
            </span>
            <span className="caption" aria-hidden="true">{r.n === 0 ? 'not eaten' : r.low + r.high === 0 ? 'in range' : [r.low ? `${r.low} low` : '', r.high ? `${r.high} high` : ''].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ol>
      <p className={`ff-wd-note ${trend.kind}`}><span className="ff-wd-tag">{trend.kind === 'meal' ? 'Follows the food' : trend.kind === 'meal+weekday' ? `The food on ${WD[trend.weekday!]}s` : trend.kind === 'weekday' ? `Follows ${WD[trend.weekday!]}s` : trend.kind === 'few' ? 'Too few times yet' : 'No weekday pattern'}</span> {trend.note}</p>
    </section>
  );
}

const UNNAMED = 'Carbs';
const OUTCOME_WORD: Record<MealOutcome, string> = { in: `Stayed ${rangeText()}`, high: `Above ${BANDS.high}`, low: `Below ${BANDS.low}` };
const OUTCOME_SHORT: Record<MealOutcome, string> = { in: 'in range', high: 'high', low: 'low' };

export type FoodSort = 'recent' | 'most' | 'out';
const SORTS: { value: FoodSort; label: string; title: string }[] = [
  { value: 'recent', label: 'Recent', title: 'Most recently eaten first' },
  { value: 'most', label: 'Most eaten', title: 'Eaten the most times first' },
  { value: 'out', label: 'Out of range', title: `Most times above ${BANDS.high} or below ${BANDS.low} first` },
];
const SORT_KEY = 'loopstack.foodSort';

/** Order foods for the ledger. Ties fall back to last eaten, then name. Pure, for testing. */
export function sortGroups(groups: readonly MealGroup[], meals: readonly Pick<MealResponse, 'name' | 'at'>[], by: FoodSort): MealGroup[] {
  const last = new Map<string, number>();
  for (const m of meals) last.set(m.name, Math.max(last.get(m.name) ?? 0, m.at));
  const recency = (a: MealGroup, b: MealGroup) => (last.get(b.name) ?? 0) - (last.get(a.name) ?? 0) || a.name.localeCompare(b.name);
  const out = (g: MealGroup) => g.outcomes.high + g.outcomes.low;
  const worst = (g: MealGroup) => (g.buckets.high3 + g.buckets.low3) * 100 + (g.buckets.high2 + g.buckets.low2);
  return [...groups].sort((a, b) => {
    if (by === 'most') return b.n - a.n || recency(a, b);
    if (by === 'out') return out(b) - out(a) || worst(b) - worst(a) || recency(a, b);
    return recency(a, b);
  });
}

/** The chosen order, remembered on this Mac (a convenience; it defaults to recent). */
function useFoodSort() {
  const [by, setBy] = useState<FoodSort>(() => {
    try { const v = localStorage.getItem(SORT_KEY); return v === 'most' || v === 'out' ? v : 'recent'; } catch { return 'recent'; }
  });
  const set = (v: FoodSort) => { setBy(v); try { localStorage.setItem(SORT_KEY, v); } catch { /* not remembered */ } };
  return [by, set] as const;
}

function SortControl({ by, onChange }: { by: FoodSort; onChange: (v: FoodSort) => void }) {
  return <TileSelect label="Sort foods by" value={by} options={SORTS} onChange={onChange} />;
}

function useLedger() {
  const [by, setBy] = useFoodSort();
  const base = useMemo(() => {
    const groups = MEALS.groups.filter((g) => g.name !== UNNAMED);
    const unnamed = MEALS.groups.find((g) => g.name === UNNAMED)?.n ?? 0;
    const longest = Math.max(60, ...MEALS.recent.flatMap((m) => [m.enteredMin ?? 0, m.observedMin ?? 0]));
    return { groups, unnamed, scale: Math.ceil(longest / 60) * 60 };
  }, []);
  const groups = useMemo(() => sortGroups(base.groups, MEALS.recent, by), [base, by]);
  return { ...base, groups, by, setBy };
}

/** "🥣 Oatmeal + berries" → ["🥣", "Oatmeal + berries"], so the emoji can sit in its own column. */
function split(name: string): [string, string] {
  const m = name.match(/^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)\s*(.*)$/u);
  return m ? [m[1], m[2]] : ['', name];
}

/** "2 in range · 6 high · 1 low"; `long` adds how many went dangerously far: "6 high (1 over 220)". */
function outcomeLine(g: MealGroup, long = false): string {
  const o = g.outcomes;
  const b = g.buckets;
  const part = (k: MealOutcome, n: number, danger: number, edge: string) => `${n} ${OUTCOME_SHORT[k]}${long && danger ? ` (${danger} ${edge})` : ''}`;
  return [
    o.in ? `${o.in} ${OUTCOME_SHORT.in}` : '',
    o.high ? part('high', o.high, b.high3, `over ${BANDS.high + 40}`) : '',
    o.low ? part('low', o.low, b.low3, `under ${BANDS.urgentLow - 5}`) : '',
  ].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------ marks


/** Entered (outline) against observed (solid) on one shared scale, so the gap reads at a glance. */
function Durations({ entered, observed, scale, compact = false }: { entered: number | null; observed: number | null; scale: number; compact?: boolean }) {
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <span className={`ff-dur${compact ? ' compact' : ''}`} aria-label={`Absorption entered ${dur(entered)}, observed ${dur(observed)}`}>
      <span className="ff-dur-row">
        <span className="ff-dur-key">entered</span>
        <span className="ff-dur-track">{entered != null && <i className="ff-dur-bar entered" style={{ width: pct(entered) }} />}</span>
        <span className="ff-dur-val">{dur(entered)}</span>
      </span>
      <span className="ff-dur-row">
        <span className="ff-dur-key">observed</span>
        <span className="ff-dur-track">{observed != null ? <i className="ff-dur-bar observed" style={{ width: pct(observed) }} /> : <i className="ff-dur-none" />}</span>
        <span className="ff-dur-val">{observed == null ? 'absorbing' : dur(observed)}</span>
      </span>
    </span>
  );
}

function OutcomeChip({ m }: { m: MealResponse }) {
  const value = m.outcome === 'low' ? m.lowMgdl : m.outcome === 'high' ? m.highMgdl : null;
  return (
    <span className={`ff-chip ${m.outcome}`}>
      <i className={`ff-mark ${m.outcome}`} aria-hidden="true" />
      {OUTCOME_WORD[m.outcome]}{value != null ? ` · ${value}` : ''}
    </span>
  );
}

// ------------------------------------------------------------ chart: every curve, one picked


// ------------------------------------------------------------ glance: food cards, 4 across, each with a dropdown

// ------------------------------------------------------------ one food, read two ways: all observed or the last 3

export type FoodScope = 'all' | 'last3';
/** The times a scope covers, newest first. Pure, for testing. */
export function scopeMeals<T extends Pick<MealResponse, 'at'>>(meals: readonly T[], scope: FoodScope): T[] {
  const newest = [...meals].sort((a, b) => b.at - a.at);
  return scope === 'last3' ? newest.slice(0, 3) : newest;
}
const med = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
/** The typical response across some times: absorbed-in, the rise and when it peaked, and how each went. Pure, for testing. */
export function scopeStats(meals: readonly (Pick<MealResponse, 'observedMin' | 'enteredMin' | 'riseMgdl' | 'peakAfterMin' | 'peakMgdl' | 'outcome'> & { riseMin?: number | null })[]) {
  const obs = meals.map((m) => m.observedMin).filter((v): v is number => v != null);
  const ent = meals.map((m) => m.enteredMin).filter((v): v is number => v != null);
  return {
    n: meals.length,
    observedMin: med(obs),
    riseMin: med(meals.map((m) => m.riseMin).filter((v): v is number => v != null)),
    enteredMin: med(ent),
    rise: med(meals.map((m) => m.riseMgdl)),
    peakAfterMin: med(meals.map((m) => m.peakAfterMin)),
    peakMgdl: med(meals.map((m) => m.peakMgdl)),
    outcomes: { in: meals.filter((m) => m.outcome === 'in').length, high: meals.filter((m) => m.outcome === 'high').length, low: meals.filter((m) => m.outcome === 'low').length },
  };
}
const outcomesLine = (o: { in: number; high: number; low: number }) =>
  [o.in ? `${o.in} stayed ${rangeText()}` : '', o.high ? `${o.high} above ${BANDS.high}` : '', o.low ? `${o.low} below ${BANDS.low}` : ''].filter(Boolean).join(' · ') || '—';

/**
 * A food's typical glucose after it (median and middle half of `meals`, 70–180 shaded) with one
 * time drawn over it. `compact` drops the axis labels for the home card.
 */
/** Half-hour steps, as a sticker reads them: 210 → "3½h", 45 → "1h" (rounded up), 30 → "½h". */
export function halfHours(min: number): string {
  const halves = Math.max(1, Math.round(min / 30));
  const h = Math.floor(halves / 2);
  return `${h || ''}${halves % 2 ? '½' : ''}h`;
}

/** Where a separate meal started during this time: its line goes dashed from here. */
export const cutAt = (m: Pick<MealResponse, 'splitMin'>): number | null => m.splitMin ?? null;

/** The carbs that came in after this time, in words: "+30 g at 45m, same meal" or "+25 g at 3h, a separate meal". */
export function addsLine(m: Pick<MealResponse, 'adds'>, span = WINDOW_MIN): string | null {
  const shown = m.adds.filter((a) => a.min <= span);
  if (!shown.length) return null;
  const sep = shown.find((a) => !a.sameMeal);
  const same = shown.filter((a) => a.sameMeal);
  const parts: string[] = [];
  if (same.length) parts.push(`+${same.reduce((t, a) => t + a.grams, 0)} g at ${dur(same[0].min)}, same meal`);
  if (sep) parts.push(`+${sep.grams} g at ${dur(sep.min)}, a separate meal: dashed after`);
  return parts.join(' · ');
}

/** Axis labels that fit the span: every 30 minutes up to 3h, every hour to 6h, every 2 hours past that. */
export const axisTicks = (span: number): number[] => {
  const step = span <= 180 ? 30 : span <= 360 ? 60 : 120;
  const out: number[] = [];
  for (let t = 0; t <= span; t += step) out.push(t);
  return out;
};

/** How a time's absorption ran against what Loop was told: "+38m longer than entered", "12m shorter", or null when either is missing. */
export function durationDelta(entered: number | null, observed: number | null): { min: number; text: string } | null {
  if (entered == null || observed == null) return null;
  const min = Math.round(observed - entered);
  if (Math.abs(min) < 5) return { min: 0, text: 'about what was entered' };
  return { min, text: `${dur(Math.abs(min))} ${min > 0 ? 'longer' : 'shorter'} than entered` };
}

/** A chart's time axis: whichever is longer, the time entered or the time observed, to the next half hour; never under 1½h or over the 12h of readings. */
export function durationSpan(entered: number | null, observed: number | null): number {
  return Math.min(WINDOW_MIN, Math.max(90, Math.ceil(Math.max(entered ?? 0, observed ?? 0) / 30) * 30));
}

/** The card's time axis: this food's own window (how long it usually takes), never less than 1½h or more than 12h. */
export function cardSpan(typicalMin: number | null, curveEnds: readonly number[]): number {
  const want = Math.max(typicalMin ?? 0, ...curveEnds, 90);
  return Math.min(WINDOW_MIN, Math.ceil(want / 30) * 30);
}

function FoodChart({ meals, highlight, W, H, compact = false, span = WINDOW_MIN, entered = null, observed = null }: { meals: readonly MealResponse[]; highlight: MealResponse | null; W: number; H: number; compact?: boolean;
  /** Minutes entered with the carbs and minutes observed, drawn as two marks on the axis with the gap between them shaded. */
  entered?: number | null; observed?: number | null;
  /** Minutes across the chart. The home card uses the food's own window, so a short food fills the card. */
  span?: number }) {
  const b = curveBands(meals, Math.min(meals.length > 3 ? 3 : 2, meals.length));
  const pad = compact ? { L: 2, R: 2, T: 4, B: 4 } : { L: 30, R: 8, T: 6, B: 18 };
  const pw = W - pad.L - pad.R;
  const ph = H - pad.T - pad.B;
  const all = [...b.map((x) => x.p75), ...(highlight?.curve.map((c) => c[1]) ?? []), ...(highlight?.tail.map((c) => c[1]) ?? [])];
  // The home card fits its scale to this food's own range (with your band always in view), so a 56px
  // sparkline still shows the rise; the full chart keeps the shared 40–220+ scale.
  const lows = [...b.map((x) => x.p25), ...(highlight?.curve.map((c) => c[1]) ?? []), ...(highlight?.tail.map((c) => c[1]) ?? [])];
  const ymax = compact ? Math.max(190, Math.max(0, ...all) + 10) : Math.max(220, Math.ceil(Math.max(0, ...all) / 20) * 20 + 20);
  const ymin = compact ? Math.min(60, Math.min(400, ...lows) - 10) : 40;
  const X = (m: number) => pad.L + (Math.min(m, span) / span) * pw;
  const Y = (g: number) => pad.T + ((ymax - Math.min(ymax, Math.max(ymin, g))) / (ymax - ymin)) * ph;
  const inSpan = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t <= span);
  const pts = (k: 'p25' | 'p50' | 'p75') => inSpan(b).map((x) => `${X(x.t).toFixed(1)} ${Y(x[k]).toFixed(1)}`);
  const hc = highlight ? highlight.curve.filter(([t]) => t <= span) : [];
  const line = hc.length > 1 ? `M${hc.map(([t, g]) => `${X(t).toFixed(1)} ${Y(g).toFixed(1)}`).join('L')}` : null;
  // A separate meal didn't end the line: it keeps going to its full length, dashed from there, and every
  // carb entry gets a pin on the time axis (the board's call). Only the solid part feeds the usual curve.
  const cut = highlight ? cutAt(highlight) : null;
  const tc = highlight && hc.length ? [hc[hc.length - 1], ...highlight.tail.filter(([t]) => t <= span)] : [];
  const tail = tc.length > 1 ? `M${tc.map(([t, g]) => `${X(t).toFixed(1)} ${Y(g).toFixed(1)}`).join('L')}` : null;
  const pins = highlight ? highlight.adds.filter((a) => a.min > 0 && a.min <= span) : [];
  const base = H - pad.B;
  const cs = compact ? 3.5 : 5;
  const peak = b.reduce<CurveBand | null>((a, x) => (!a || x.p50 > a.p50 ? x : a), null);
  const label = [
    b.length ? `Usually after it (${meals.length} ${meals.length === 1 ? 'time' : 'times'}): starts at ${b[0].p50}, peaks near ${peak!.p50} mg/dL ${dur(peak!.t)} after.` : 'Not enough readings to draw the usual curve.',
    highlight ? `${highlight.when}: ${highlight.startMgdl} to a peak of ${highlight.peakMgdl} at ${dur(highlight.peakAfterMin)}, ${OUTCOME_WORD[highlight.outcome].toLowerCase()}.${pins.length ? ` More carbs: ${pins.map((a) => `${a.grams} grams at ${dur(a.min)}${a.sameMeal ? ', same meal' : ', a separate meal'}`).join('; ')}.` : ''}${cut != null ? ' The line is dashed after the separate meal and not counted in the usual curve.' : ''}` : '',
    entered != null && observed != null ? `Entered ${dur(entered)}, observed ${dur(observed)}: ${durationDelta(entered, observed)!.text}.` : '',
    `${BANDS.low} to ${BANDS.high} shaded.`,
  ].filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={pad.L} y={Y(BANDS.high)} width={pw} height={Y(BANDS.low) - Y(BANDS.high)} style={{ fill: 'var(--range-in-soft)' }} />
      {!compact && [BANDS.low, BANDS.high].map((v) => <text key={v} x={pad.L - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>)}
      {b.length > 1 && <path d={`M${pts('p75').join('L')}L${pts('p25').reverse().join('L')}Z`} style={{ fill: 'var(--ink-300)' }} opacity="0.5" />}
      {b.length > 1 && <path d={`M${pts('p50').join('L')}`} fill="none" style={{ stroke: 'var(--ink-600)' }} strokeWidth={compact ? 1.4 : 2} strokeLinejoin="round" />}
      {pins.map((a) => (
        <g key={`${a.min}-${a.grams}`}>
          <line x1={X(a.min)} x2={X(a.min)} y1={pad.T} y2={base} style={{ stroke: 'var(--ink-500)' }} strokeWidth="1" />
          <path d={`M${X(a.min) - cs} ${base}L${X(a.min)} ${base - cs * 1.6}L${X(a.min) + cs} ${base}Z`} style={{ fill: 'var(--ink-900)' }} />
          {!compact && <text x={X(a.min) + 6} y={pad.T + 11} fontSize="11" fontWeight="600" style={{ fill: 'var(--ink-900)', paintOrder: 'stroke', stroke: 'var(--surface-0)', strokeWidth: 3 }}>+{a.grams} g{a.name !== 'Carbs' ? ` ${a.name}` : ''}</text>}
        </g>
      ))}
      {line && <path d={line} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth={compact ? 2.2 : 2.6} strokeLinejoin="round" strokeLinecap="round" />}
      {tail && <path d={tail} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth={compact ? 2 : 2.3} strokeDasharray={compact ? '3 3' : '5 5'} strokeLinecap="round" />}
      {(entered != null || observed != null) && (() => {
        const a = entered != null ? X(entered) : null;
        const b = observed != null ? X(observed) : null;
        const d = durationDelta(entered, observed);
        const r = compact ? 3 : 4.5;
        return (
          <g>
            {a != null && b != null && Math.abs(b - a) > 1 && <rect x={Math.min(a, b)} y={base - 4} width={Math.abs(b - a)} height={4} style={{ fill: 'var(--ink-900)' }} opacity="0.2" />}
            {a != null && <circle cx={a} cy={base - 2} r={r} style={{ fill: 'var(--surface-0)', stroke: 'var(--ink-900)' }} strokeWidth="1.8" />}
            {b != null && <circle cx={b} cy={base - 2} r={r} style={{ fill: 'var(--ink-900)', stroke: 'var(--surface-0)' }} strokeWidth="1.2" />}
            {!compact && a != null && b != null && d && d.min !== 0 && <text x={(a + b) / 2} y={base - 12} fontSize="11" fontWeight="600" textAnchor="middle" style={{ fill: 'var(--ink-900)', paintOrder: 'stroke', stroke: 'var(--surface-0)', strokeWidth: 3 }}>{d.min > 0 ? '+' : '−'}{dur(Math.abs(d.min))}</text>}
          </g>
        );
      })()}
      {!compact && axisTicks(span).map((t) => <text key={t} x={X(t)} y={H - 4} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{t ? (t < 60 ? `${t}m` : dur(t)) : 'meal'}</text>)}
    </svg>
  );
}

/** How one time went, in a few words: "peaked 204 at 1h, above 180". */
const effectOf = (m: MealResponse) => `peaked ${m.peakMgdl} at ${dur(m.peakAfterMin)} · ${OUTCOME_WORD[m.outcome].toLowerCase()}${m.observedMin != null ? ` · absorbed in ${dur(m.observedMin)}` : ''}`;

/**
 * One food, focused (the board's model): its typical response first, for all observed times or the
 * last 3 (the switch recomputes the curve and every number, and each caption names its scope);
 * the times themselves on request, each opening "this time against typical". The most recent time
 * stays drawn over the curve, so the home card's picture carries straight into this view.
 */
function FoodFocus({ g, scale, wide, actions }: { g: MealGroup; scale: number; wide: boolean; actions: ReactNode }) {
  const meals = MEALS.recent.filter((m) => m.name === g.name);
  const [scope, setScope] = useState<FoodScope>('all');
  const [listOpen, setListOpen] = useState(false);
  const shown = scopeMeals(meals, scope);
  const [pickedId, setPickedId] = useState<string | null>(shown[0]?.id ?? null);
  const picked = shown.find((m) => m.id === pickedId) ?? null;
  const st = scopeStats(shown);
  const of = scope === 'all' ? `median of ${st.n}` : 'median of the last 3';
  const setScopeKeep = (v: FoodScope) => { setScope(v); const next = scopeMeals(meals, v); if (!next.some((m) => m.id === pickedId)) setPickedId(next[0]?.id ?? null); };
  const canLast3 = meals.length > 3;
  // The axis runs as long as the longer of the time entered and the time observed, for the time picked
  // (else the food's median), so a food that took longer than entered shows its full duration.
  const chartEntered = picked ? picked.enteredMin : st.enteredMin;
  const chartObserved = picked ? picked.observedMin : st.observedMin;
  const delta = durationDelta(chartEntered, chartObserved);
  return (
    <div className={`ff-focus${wide ? ' wide' : ''}`}>
      <div className="row between wrap ff-focus-head">
        <span className="caption">{picked ? <>Drawn over the usual curve: <b className="strong">{picked.when}</b>, {effectOf(picked)}</> : 'The usual curve'}</span>
        {canLast3 && <Segmented size="sm" label="Which times this reads" items={[{ value: 'all', label: `All observed · ${meals.length}` }, { value: 'last3', label: 'Last 3' }]} value={scope} onChange={setScopeKeep} />}
      </div>
      <div className="ff-focus-grid">
        <div className="stack-4">
          <Fit className={wide ? 'chart-md' : 'ff-dd-chart'}>{({ w, h }) => <FoodChart meals={shown} highlight={picked} W={w} H={h} span={durationSpan(chartEntered, chartObserved)} entered={chartEntered} observed={chartObserved} />}</Fit>
          <span className="caption">Grey: median and middle half of {scope === 'all' ? `all ${st.n} times` : 'the last 3 times'}, as far as the longer of entered and observed. Dark line: the time picked below. {rangeText()} shaded.{chartEntered != null && chartObserved != null && <> Hollow mark: entered {dur(chartEntered)}. Solid mark: observed {dur(chartObserved)}{delta ? <>, {delta.text}</> : null}.</>}</span>
        </div>
        <div className="ff-focus-stats">
          <span><span className="caption">Absorbed in, Loop’s count</span><b>{st.observedMin == null ? '—' : dur(st.observedMin)}</b><span className="caption">{of} · {dur(st.enteredMin)} entered{durationDelta(st.enteredMin, st.observedMin) ? ` · ${durationDelta(st.enteredMin, st.observedMin)!.text}` : ''}</span></span>
          <span><span className="caption">Rise</span><b>+{st.rise ?? '—'}</b><span className="caption">mg/dL at {dur(st.peakAfterMin)}, {of}{st.riseMin != null ? ` · rise landed by ${dur(st.riseMin)}` : ''}</span></span>
          <span className="full"><span className="caption">Afterwards</span><b className="ff-dd-out">{outcomesLine(st.outcomes)}</b><span className="caption">{scope === 'all' ? `of all ${st.n} times` : 'of the last 3'}</span></span>
          <Durations entered={st.enteredMin} observed={st.observedMin} scale={scale} />
        </div>
      </div>
      <ByWeekday meals={meals} name={g.name} />
      <div className="ff-focus-times">
        <button type="button" className="ff-disc" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)}>
          <span className="ff-disc-chev" aria-hidden="true"><IChevron /></span>{scope === 'all' ? `All ${st.n} times` : 'The last 3 times'}
        </button>
        {listOpen && (
          <ul className="ff-times" aria-label={scope === 'all' ? 'Every time, newest first' : 'The last 3 times'}>
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" className="ff-time" aria-pressed={m.id === pickedId} onClick={() => setPickedId(m.id === pickedId ? null : m.id)}>
                  <span className="ff-time-when">{m.when}</span>
                  <span>{m.carbsG} g · {m.bolusU} U</span>
                  <span>{m.startMgdl} → {m.peakMgdl} <span className="caption">at {dur(m.peakAfterMin)}</span></span>
                  <OutcomeChip m={m} />
                  <span>{m.observedMin == null ? 'absorbing' : dur(m.observedMin)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <dl className="ff-vs" aria-label="This time against typical">
            <div><dt>This time</dt><dd>{picked.when}</dd></div>
            <div><dt>Peak</dt><dd>{picked.peakMgdl} <span className="caption">vs {st.peakMgdl ?? '—'} typical</span></dd></div>
            <div><dt>Absorbed in</dt><dd>{picked.observedMin == null ? '—' : dur(picked.observedMin)} <span className="caption">vs {st.observedMin == null ? '—' : dur(st.observedMin)}</span></dd></div>
            <div><dt>Rise landed in</dt><dd>{picked.riseMin == null ? '—' : dur(picked.riseMin)} <span className="caption">90% of the rise</span></dd></div>
            <div><dt>Carbs · bolus</dt><dd>{picked.carbsG} g · {picked.bolusU} U <span className="caption">{dur(picked.enteredMin)} entered</span></dd></div>
          </dl>
        )}
      </div>
      <div className="row wrap ff-dd-actions">
        {actions}
        {(picked ?? shown[0]) && <NoteButton anchor={mealAnchor(g.name, (picked ?? shown[0])!)} snapshot={mealSnapshot((picked ?? shown[0])!)} chip={`${split(g.name)[1]} · ${(picked ?? shown[0])!.when}`} />}
      </div>
    </div>
  );
}


/** The widget at full width shows 8 foods four across; narrower, 4 in a 2×2. Show more lists the rest. Pure, for testing. */
export function glanceLayout(tileW: number, total: number, more: boolean, tileH = 3) {
  const full = tileW >= 12;
  // Under 3 rows tall there's room for one row of cards, not two: the rest wait behind Show more.
  const rows = tileH < 3 ? 1 : 2;
  const limit = (full ? 4 : 2) * rows;
  return { cols: full ? 4 : 2, shown: more ? total : Math.min(total, limit), hidden: Math.max(0, total - limit) };
}

export function FavoriteFoodsGlance({ go, w, h }: FaceProps) {
  const { groups, by, setBy } = useLedger();
  const [more, setMore] = useState(false);
  if (!groups.length) return <div className="face"><p className="small">No named meals with enough CGM readings after them in the last {MEALS.days} days. Favorites and food types you use in Loop show up here.</p></div>;
  const { cols, shown, hidden } = glanceLayout(w, groups.length, more, h);
  return (
    <div className="face ff-glance">
      <div className="row between wrap ff-head">
        <span className="caption">{groups.length} {groups.length === 1 ? 'food' : 'foods'} · last {MEALS.days} days · pick one for more</span>
        <SortControl by={by} onChange={setBy} />
        <OutcomeKey />
      </div>
      {/* A card shows only the most recent time; picking it opens the full page with that food focused. */}
      <CardGrid groups={groups.slice(0, shown)} cols={cols} idPrefix="ffg" label="Favorite foods" panel={() => null} onPick={(g) => { openFood(g.name); go({ tile: 'meals' }); }} />
      {hidden > 0 && (
        <button type="button" className="text-btn ff-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : `Show ${hidden} more`} <span className="ff-more-chev" aria-hidden="true"><IChevron /></span>
        </button>
      )}
    </div>
  );
}

function OutcomeKey() {
  return (
    <div className="ff-key caption" aria-hidden="true">
      <span><i className="ff-sw t3" />Dangerously high or low</span><span><i className="ff-sw t2" />High or low</span><span><i className="ff-sw t1" />Caution buffer</span><span><i className="ff-sw in" />In range</span>
    </div>
  );
}

// ------------------------------------------------------------ detail: a grid of favorites, one open at a time


/** A food's confidence as tracking reads it: the engine's grade when it has a suggestion, else how many times it's been eaten. */
const gradeFor = (n: number): Confidence => (n >= 8 ? 'good' : n >= 5 ? 'limited' : 'unusable');

/** Whether a food is tracked, and its suggestion if Suggestions has one. Same id either way, so both places agree. */
function useFoodTracking(g: MealGroup) {
  const t = useTracked();
  const id = foodId(g.name);
  const sugg = SUGGESTIONS.find((s) => s.id === id) ?? null;
  const tracked = t.all[id] && t.all[id].state !== 'dismissed' ? t.all[id] : null;
  return { t, id, sugg, tracked };
}

/** Track (white glass, green +) or Tracking: the food goes to Suggestions to watch its readings build. */
function TrackButton({ g }: { g: MealGroup }) {
  const { t, id, sugg, tracked } = useFoodTracking(g);
  const announce = useAnnounce();
  const [confirmStop, setConfirmStop] = useState(false);
  const label = split(g.name)[1];
  const today = DATA.today;
  // Built is a record of what went into your Loop: it isn't undone from here.
  if (tracked?.state === 'built') return <span className="track-btn glass on" role="status">Built</span>;
  // Staged is in your next build: taking it out asks once, as Suggestions does.
  if (tracked) return (
    <button type="button" className="track-btn glass on" aria-pressed="true"
      aria-label={confirmStop ? `Press again to take ${label} out of your next build and stop tracking` : `Tracking ${label}. Press to stop`}
      onBlur={() => setConfirmStop(false)}
      onClick={() => {
        if (tracked.state === 'staged' && !confirmStop) { setConfirmStop(true); return; }
        t.forget(id); setConfirmStop(false); announce(`Stopped tracking ${label}.`);
      }}>{confirmStop ? 'Press again to stop' : 'Tracking'}</button>
  );
  return (
    <button type="button" className="track-btn glass" onClick={() => {
      t.track(id, today, { date: today, confidence: sugg?.confidence ?? gradeFor(g.n), reading: sugg?.reading ?? null });
      announce(`Tracking ${label}. It shows in Suggestions as its readings build.`);
    }}><IPlus />Track</button>
  );
}




/** What one time came to, for a dot: stayed in range, went high or low, and whether it went dangerously far (tier 3). */
export type DotKind = 'in' | 'high' | 'low' | 'highX' | 'lowX';
export const dotKind = (m: Pick<MealResponse, 'outcome' | 'tier'>): DotKind =>
  m.outcome === 'in' ? 'in' : m.outcome === 'high' ? (m.tier >= 3 ? 'highX' : 'high') : (m.tier >= 3 ? 'lowX' : 'low');

/** The last `n` times a food was eaten, oldest first (so the newest sits on the right), as dots. Pure, for testing. */
export function lastTimes<T extends Pick<MealResponse, 'at' | 'outcome' | 'tier'>>(meals: readonly T[], n = 10): { time: T; kind: DotKind; recent: boolean }[] {
  const newest = [...meals].sort((a, b) => b.at - a.at).slice(0, n);
  return newest.reverse().map((time, i, all) => ({ time, kind: dotKind(time), recent: i >= all.length - 3 }));
}

const DOT_WORD: Record<DotKind, string> = { in: 'stayed in range', high: 'went high', low: 'went low', highX: 'went dangerously high', lowX: 'went dangerously low' };
const DOT_PATH: Record<DotKind, string> = {
  in: 'M6 1.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z',
  high: 'M6 1.5 L10.5 10 L1.5 10 Z',
  highX: 'M6 0.5 L11.5 11 L0.5 11 Z',
  low: 'M6 10.5 L10.5 2 L1.5 2 Z',
  lowX: 'M6 11.5 L11.5 1 L0.5 1 Z',
};

/**
 * One dot per time this food was eaten (the last ten, oldest on the left), shape and colour together:
 * circle in range, triangle high or low, larger and darker when dangerous. A bar under the newest three
 * ties it to the "Last 3" switch in the full view. It says what happened, never what to change.
 */
function LastTimes({ meals }: { meals: readonly MealResponse[] }) {
  const dots = lastTimes(meals);
  if (!dots.length) return null;
  const inN = dots.filter((d) => d.kind === 'in').length;
  const words = `${inN} of the last ${dots.length} stayed 70–180`;
  const short = `${inN} of last ${dots.length} in range`;
  return (
    <span className="ff-dots-wrap" role="img" aria-label={`The last ${dots.length} times, oldest first: ${dots.map((d) => DOT_WORD[d.kind]).join(', ')}. ${words}.`}>
      <span className="ff-dots" aria-hidden="true">
        {dots.map((d) => (
          <span key={d.time.at} className={`ff-dot ${d.kind}${d.recent ? ' recent' : ''}`}>
            <svg width={d.kind.endsWith('X') ? 14 : 11} height={d.kind.endsWith('X') ? 14 : 11} viewBox="0 0 12 12"><path d={DOT_PATH[d.kind]} /></svg>
            <i />
          </span>
        ))}
      </span>
      <span className="caption">{short}</span>
    </span>
  );
}

/** One favorite as a card: what it is, how often, how it went, and whether it's tracked. */
function FoodCard({ g, open, onToggle, id }: { g: MealGroup; open: boolean; onToggle: () => void; id: string }) {
  const [emoji, label] = split(g.name);
  const { tracked } = useFoodTracking(g);
  const meals = MEALS.recent.filter((m) => m.name === g.name);
  const last = scopeMeals(meals, 'all')[0] ?? null;
  // The card's axis runs as long as the longer of the time entered and the time observed for the last time.
  const span = last ? durationSpan(last.enteredMin, last.observedMin) : cardSpan(g.medianObservedMin, []);
  const lastDelta = last ? durationDelta(last.enteredMin, last.observedMin) : null;
  const more = last ? addsLine(last, span) : null;
  return (
    <li className="ff-cell">
      <button type="button" className={`ff-card${tracked ? ' tracked' : ''}`} aria-expanded={open} id={id} onClick={onToggle}
        aria-label={`${label}: ${g.medianObservedMin == null ? 'absorption time not read yet' : `usually absorbed in about ${Math.max(0.5, Math.round(g.medianObservedMin / 30) / 2)} hours`}; last time ${last ? effectOf(last) : 'no readings yet'}${more ? `; ${more}` : ''}. ${g.n} times, ${outcomeLine(g)}.${tracked ? ' Tracking.' : ''} Open its breakdown`}>
        <span className="ff-card-top">
          <span className="ff-card-name strong">{emoji && <span aria-hidden="true">{emoji} </span>}{label}</span>
          {tracked && <span className="ff-tracked caption">Tracking</span>}
          <span className="ff-card-chev" aria-hidden="true"><IChevron /></span>
        </span>
        {/* The home card: only the most recent time, drawn over the usual curve, and how it went. */}
        {last ? <>
          <span className="caption">Last time · {last.when.replace(/, \d.*$/, '')}</span>
          {/* The chart spans this food's own window (how long it usually takes), not a fixed 6 hours;
              the sticker says that time in half hours. */}
          <span className="ff-card-chart" aria-hidden="true">
            <Fit className="ff-card-fit">{({ w, h }) => <FoodChart meals={meals} highlight={last} W={w} H={h} compact span={span} entered={last?.enteredMin ?? null} observed={last?.observedMin ?? null} />}</Fit>
            {g.medianObservedMin != null && <span className="ff-sticker">~{halfHours(g.medianObservedMin)}</span>}
          </span>
          <span className="small"><span className="strong">{last.peakMgdl}</span> peak at {dur(last.peakAfterMin)} · <span className={`ff-word ${last.outcome}`}>{OUTCOME_WORD[last.outcome]}</span></span>
          {last.enteredMin != null && last.observedMin != null && <span className="caption">Entered {dur(last.enteredMin)} · took {dur(last.observedMin)}{lastDelta && lastDelta.min !== 0 ? ` (${lastDelta.min > 0 ? '+' : '−'}${dur(Math.abs(lastDelta.min))})` : ''}</span>}
          {more && <span className="caption">{more}</span>}
        </> : <span className="caption">No readings after it yet</span>}
        <span className="ff-card-foot">
          <span className="caption">{g.n} times · usually +{g.medianRiseMgdl} mg/dL</span>
          <LastTimes meals={meals} />
        </span>
      </button>
    </li>
  );
}

/** Columns that fit the width: cards at least `minCard` px wide, never more than `max`. */
const GAP = 12;
function useColumns(max: number, minCard: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [cols, setCols] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setCols(Math.max(1, Math.min(max, Math.floor((el.clientWidth + GAP) / (minCard + GAP)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, minCard]);
  return [ref, cols] as const;
}

/**
 * Food cards in rows, one open at a time. The open card's panel sits after the
 * last card of its row, full width, so everything below moves down; it opens
 * and folds with an animation, and Escape closes it.
 */
function CardGrid({ groups, max = 6, minCard = 168, cols: fixed, idPrefix, label, panel, onPick, initialOpen = null }: { groups: MealGroup[]; max?: number; minCard?: number; cols?: number; idPrefix: string; label: string; panel: (g: MealGroup, close: () => void) => ReactNode;
  /** Instead of opening a panel in place, hand the picked food to the caller (the home card opens the full page). */
  onPick?: (g: MealGroup) => void;
  /** A food to open when the grid first draws. */
  initialOpen?: string | null }) {
  // A fixed column count (the widget) or as many as fit (the full page).
  const [ref, fit] = useColumns(fixed ?? max, fixed ? 1 : minCard);
  const cols = fixed ?? fit;
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [closing, setClosing] = useState<{ name: string; row: number } | null>(null);
  const panelRef = useRef<HTMLLIElement>(null);
  const cardId = (name: string) => `${idPrefix}-${foodId(name)}`;
  const idx = groups.findIndex((g) => g.name === open);
  const row = idx < 0 ? -1 : Math.floor(idx / cols);

  const close = (focus = true) => {
    if (open == null) return;
    const name = open;
    setClosing({ name, row });
    setOpen(null);
    if (focus) requestAnimationFrame(() => document.getElementById(cardId(name))?.focus());
  };
  const toggle = (name: string) => {
    if (open === name) return close(false);
    const nextRow = Math.floor(groups.findIndex((g) => g.name === name) / cols);
    // Another row: the old panel folds shut while the new one opens. Same row: the panel stays and its content changes.
    if (open != null && nextRow !== row) setClosing({ name: open, row });
    setOpen(name);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => panelRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 340);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  const openGroup = groups[idx] ?? null;
  const closingGroup = closing ? groups.find((g) => g.name === closing.name) ?? null : null;
  const notch = (name: string) => ({ '--notch': `${(((groups.findIndex((g) => g.name === name) % cols) + 0.5) / cols) * 100}%` }) as CSSProperties;
  const items: ReactNode[] = [];
  groups.forEach((g, i) => {
    items.push(<FoodCard key={g.name} id={cardId(g.name)} g={g} open={g.name === open} onToggle={() => (onPick ? onPick(g) : toggle(g.name))} />);
    if (!(i % cols === cols - 1 || i === groups.length - 1)) return;
    const r = Math.floor(i / cols);
    if (openGroup && r === row) {
      items.push(
        <li key={`panel-${r}`} ref={panelRef} className="ff-expand" style={notch(openGroup.name)} role="region" aria-label={`${split(openGroup.name)[1]}, details`}>
          <div key={openGroup.name} className="ff-swap">{panel(openGroup, () => close())}</div>
        </li>,
      );
    } else if (closingGroup && closing && r === closing.row) {
      items.push(
        <li key={`panel-${r}`} className="ff-expand closing" style={notch(closingGroup.name)} aria-hidden="true" onAnimationEnd={(e) => { if (e.target === e.currentTarget) setClosing(null); }}>
          <div className="ff-swap">{panel(closingGroup, () => undefined)}</div>
        </li>,
      );
    }
  });
  return <ul ref={ref} className="ff-cards" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-label={label}>{items}</ul>;
}

/** The open food's breakdown: how it affected glucose, every time, and the two actions. */
function Breakdown({ g, scale, onClose }: { g: MealGroup; scale: number; onClose: () => void }) {
  const [emoji, label] = split(g.name);
  const { tracked, sugg } = useFoodTracking(g);
  return (
    <div className="ff-expand-inner">
      <div className="ff-bd">
        <div className="ff-bd-head">
          <div className="stack-4">
            <h2 id="ff-h" className="title ff-title"><span aria-hidden="true">{emoji}</span>{label}</h2>
            <span className="caption">{g.medianCarbsG} g median · {g.n} times in {MEALS.days} days · peak a median {dur(g.medianPeakAfterMin)} after</span>
          </div>
          <div className="row wrap ff-bd-actions">
            <TrackButton g={g} />
            <button type="button" className="quiet-btn" onClick={onClose} aria-label={`Close ${label}`}>Close</button>
          </div>
        </div>
        <FoodFocus g={g} scale={scale} wide actions={<>
          {sugg
            ? <p className="caption">Suggestions has a reading for this food: {sugg.evidence}.{tracked ? '' : ' Track it to watch its confidence build.'}</p>
            : <p className="caption">{tracked ? 'Tracked: it shows in Suggestions once its readings point somewhere.' : 'Track it to watch it in Suggestions as more meals come in.'}</p>}
        </>} />
        <p className="caption">Entered is the absorption time given to Loop with the carbs. Absorbed in is read from Loop’s own carbs on board, so it lands where Loop’s carb screen does; when two entries overlap, how Loop split the carbs between them is LoopStack’s estimate. Rise landed in is when 90% of the glucose rise after the meal had landed (entries within two hours read as one meal): a slow meal can land its rise in a few hours while Loop keeps absorbing for many more. What happened, not a setting.</p>

        {favoritesBridge() && <div className="ff-bd-loop"><LoopFavorites group={g} /></div>}
      </div>
    </div>
  );
}

export function FavoriteFoodsDetail() {
  const { groups, unnamed, scale, by, setBy } = useLedger();
  const [initial] = useState(() => takeFood());
  useEffect(() => { if (initial) requestAnimationFrame(() => document.getElementById(`ff-card-${foodId(initial)}`)?.scrollIntoView({ block: 'start' })); }, [initial]);
  if (!groups.length) return <p className="small">No named meals with enough CGM readings after them in the last {MEALS.days} days.</p>;
  return (
    <div className="ff">
      <div className="row between wrap ff-head">
        <p className="caption">Last {MEALS.days} days · named meals only{unnamed ? ` (${unnamed} unnamed carb ${unnamed === 1 ? 'entry' : 'entries'} not shown)` : ''} · each meal read from entry to 6 hours. Carbs within 2 hours count as the same meal; after a separate meal the line goes dashed and isn’t counted. Pick a food to see how it affected glucose.</p>
        <SortControl by={by} onChange={setBy} />
        <OutcomeKey />
      </div>
      <CardGrid groups={groups} max={6} minCard={168} idPrefix="ff-card" label="Favorite foods" initialOpen={initial} panel={(g, close) => <Breakdown g={g} scale={scale} onClose={close} />} />
    </div>
  );
}
