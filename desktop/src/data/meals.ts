// Meal response: what glucose and insulin did after each carb entry. For each
// meal: the glucose at entry, the peak and when it came, the rise, the 2-hour
// value, the absorption time Loop was given (entered) against how long it
// took (observed: the phone app's done-time, else Loop's carb count;
// carbAbsorbed.ts), how long glucose took to come back near
// where it started (back), and active insulin at entry and at its peak.
// Grouped by the meal's name so repeats line up.
// Observations only (SAFE-1): it says what happened, never what to enter.
import { absorbKey } from './carbAbsorbed';
import { BANDS, highTierOf, lowTierOf, type Bands, type Tier } from './ranges';

export interface MealResponse {
  id: string;
  /** ms */
  at: number;
  /** "Tue Nov 10, 12:15pm" */
  when: string;
  /** Loop's food type / favorite name, else "Carbs". */
  name: string;
  carbsG: number;
  /** Insulin the person bolused within 15 minutes of the entry, U. */
  bolusU: number;
  /** Absorption time entered with the carbs, minutes; null if none. */
  enteredMin: number | null;
  /** Minutes until 90% of the sitting's glucose rise had landed, from this entry (the phone app's done-time), else Loop's own carb count; null while still absorbing or without the data (carbAbsorbed.ts). */
  observedMin: number | null;
  /** True when the counteraction carried it, not Loop's minimum rate. */
  observedByGlucose: boolean;
  /** Minutes until 90% of the glucose rise had landed (the phone app's done-time); null when it can't be read. A rise can land long before Loop finishes absorbing. */
  riseMin: number | null;
  /** Minutes until glucose came back within 20 mg/dL of the start; null if it didn't within 12 hours, or another meal came first. Not an absorption time. */
  backMin: number | null;
  startMgdl: number;
  peakMgdl: number;
  peakAfterMin: number;
  riseMgdl: number;
  at2hMgdl: number | null;
  iobAtEntryU: number | null;
  iobPeakU: number | null;
  /** Lowest and highest glucose from entry to 12 hours or the next separate meal (the same window as observed). */
  lowMgdl: number;
  highMgdl: number;
  /** Which way it went furthest over that window (a tie goes to low), or stayed in your band. */
  outcome: MealOutcome;
  /** How far out it went: 0 in range, 1 caution buffer, 2 high or low, 3 dangerously high or low. */
  tier: Tier;
  /** Glucose every 10 minutes for up to 12 hours from entry, stopping at the next separate meal: [minutes, mg/dL]. Only this meal's own readings: the usual curve, extremes and outcome read these. */
  curve: readonly (readonly [number, number])[];
  /** Glucose after a separate meal started, to the same 12 hours: drawn (dashed) so the full duration shows, never counted. Empty when nothing interrupted it. */
  tail: readonly (readonly [number, number])[];
  /** Minutes from entry to the separate meal that ends `curve`; null when none came within 12 hours. */
  splitMin: number | null;
  /** Carbs entered after this one within the drawn 12 hours. `sameMeal`: within 2 hours of the entry before it, so part of this meal (the phone app's rule, mealCombining.ts). */
  adds: readonly MealAdd[];
}

export interface MealAdd { min: number; grams: number; name: string; sameMeal: boolean }

/** The phone app's sitting rule: an entry within 2 hours of the one before it belongs to the same meal. */
export const SAME_MEAL_GAP_MIN = 120;

/** How long after an entry its readings are kept: 12 hours, so a slow meal (Loop allows up to 1.5x an 8h entry) shows its whole run. */
export const WINDOW_MIN = 720;

export type MealOutcome = 'low' | 'high' | 'in';

/** How far out, from your bands (ranges.ts): 0 in range; low side 1 under your low, 2 under urgent low, 3 more than 5 under it; high side 1 over your high, 2 over by 20, 3 over by 40. */
export type { Tier };
export const lowTier = (g: number, b: Bands = BANDS): Tier => lowTierOf(g, b);
export const highTier = (g: number, b: Bands = BANDS): Tier => highTierOf(g, b);

/** A meal's outcome: the side that went furthest out, and how far. A tie goes to low. */
export function outcomeOf(low: number, high: number, b: Bands = BANDS): { outcome: MealOutcome; tier: Tier } {
  const l = lowTier(low, b);
  const h = highTier(high, b);
  if (l === 0 && h === 0) return { outcome: 'in', tier: 0 };
  return l >= h ? { outcome: 'low', tier: l } : { outcome: 'high', tier: h };
}

/** Meals counted by side and tier, ordered from dangerously low to dangerously high. */
export type Bucket = 'low3' | 'low2' | 'low1' | 'in' | 'high1' | 'high2' | 'high3';
export const BUCKETS: readonly Bucket[] = ['low3', 'low2', 'low1', 'in', 'high1', 'high2', 'high3'];

export interface MealGroup {
  name: string;
  n: number;
  medianCarbsG: number;
  medianRiseMgdl: number;
  medianPeakAfterMin: number;
  medianEnteredMin: number | null;
  medianObservedMin: number | null;
  /** Meals with an observed absorption time. */
  observedN: number;
  medianBackMin: number | null;
  /** Meals whose glucose came back near the start. */
  backN: number;
  /** How many went low, high, or stayed in range. */
  outcomes: Record<MealOutcome, number>;
  /** The same, split by how far out each went. */
  buckets: Record<Bucket, number>;
}

export interface Meals {
  recent: MealResponse[];
  groups: MealGroup[];
  /** Days covered. */
  days: number;
}

export interface MealInputs {
  carbs: { at: number; grams: number; absorptionMin: number | null; name: string | null }[];
  boluses: { at: number; units: number }[];
  glucose: { at: number; mgdl: number }[];
  iob: { at: number; u: number }[];
  /** Observed absorption per entry, keyed by absorbKey(time, grams) (carbAbsorbed.ts). */
  absorbed?: ReadonlyMap<string, import('./carbAbsorbed').Absorbed>;
}

const MIN = 60_000;
const median = (v: readonly number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const whenLabel = (ms: number) => {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};

/** Sorted-array lookup: the reading nearest `t`, within `within` ms. */
function nearest<T extends { at: number }>(xs: readonly T[], t: number, within: number): T | null {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid].at < t) lo = mid + 1; else hi = mid; }
  let best: T | null = null;
  for (const i of [lo - 1, lo, lo + 1]) {
    const x = xs[i];
    if (x && Math.abs(x.at - t) <= within && (!best || Math.abs(x.at - t) < Math.abs(best.at - t))) best = x;
  }
  return best;
}

/** Binary bounds avoid scanning months of CGM records separately for each meal. */
function windowOf<T extends { at: number }>(xs: readonly T[], from: number, until: number): T[] {
  const bound = (t: number) => {
    let lo = 0, hi = xs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid].at < t) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return xs.slice(bound(from), bound(until));
}

export function mealResponses(input: MealInputs, from: number, to: number): Meals {
  const glucose = [...new Map(input.glucose.filter(g => Number.isFinite(g.at) && Number.isFinite(g.mgdl) && g.mgdl > 0 && g.at < to).map(g => [g.at, g])).values()].sort((a, b) => a.at - b.at);
  const iob = input.iob.filter(x => Number.isFinite(x.at) && Number.isFinite(x.u) && x.u >= 0).sort((a, b) => a.at - b.at);
  const carbs = input.carbs.filter(c => Number.isFinite(c.at) && Number.isFinite(c.grams) && c.grams >= 5).sort((a, b) => a.at - b.at);
  const boluses = input.boluses.filter(b => Number.isFinite(b.at) && Number.isFinite(b.units) && b.units >= 0 && b.at < to);
  // For each entry: the entries after it in the same sitting (each within 2 hours of the one before, as on
  // the phone), then the first separate meal of 15 g or more, which ends this meal's own readings.
  const sitting = carbs.map((c, i) => {
    const adds: MealAdd[] = [];
    let prev = c.at;
    let next = Infinity;
    for (let j = i + 1; j < carbs.length && carbs[j].at < c.at + WINDOW_MIN * MIN; j += 1) {
      const e = carbs[j];
      const same = next === Infinity && e.at - prev <= SAME_MEAL_GAP_MIN * MIN;
      if (same) prev = e.at;
      else if (next === Infinity && e.grams >= 15) next = e.at;
      adds.push({ min: Math.round((e.at - c.at) / MIN), grams: Math.round(e.grams), name: e.name?.trim() || 'Carbs', sameMeal: same });
    }
    if (next === Infinity) for (let j = i + 1; j < carbs.length; j += 1) if (carbs[j].grams >= 15 && carbs[j].at - prev > SAME_MEAL_GAP_MIN * MIN) { next = carbs[j].at; break; }
    return { adds, next };
  });
  const recent: MealResponse[] = [];
  carbs.forEach((c, i) => {
    if (c.at < from || c.at >= to) return;
    const start = nearest(glucose, c.at, 10 * MIN);
    if (!start) return;
    // The window ends at the next separate meal of 15 g or more, or after 4 hours.
    const next = sitting[i].next;
    const end = Math.min(c.at + 4 * 60 * MIN, next, to);
    const win = windowOf(glucose, c.at, end);
    if (win.length < 6) return;
    const peak = win.reduce((p, g) => (g.mgdl > p.mgdl ? g : p));
    // Observed: first time after the peak that glucose is back within 20 of the start (up to 12 h, before the next meal).
    const observedEnd = Math.min(c.at + WINDOW_MIN * MIN, next, to);
    const after = windowOf(glucose, peak.at + 1, observedEnd);
    const back = peak.mgdl - start.mgdl < 20 ? peak : after.find((g) => g.mgdl <= start.mgdl + 20);
    const curve: [number, number][] = [];
    for (let m = 0; m <= WINDOW_MIN; m += 10) {
      const g = nearest(glucose, c.at + m * MIN, 6 * MIN);
      if (g && c.at + m * MIN < observedEnd && g.at >= c.at && g.at < observedEnd) curve.push([m, g.mgdl]);
    }
    // After a separate meal: kept for drawing the full duration, never counted.
    const tailEnd = Math.min(c.at + WINDOW_MIN * MIN, to);
    const tail: [number, number][] = [];
    if (next < tailEnd) for (let m = 0; m <= WINDOW_MIN; m += 10) {
      const g = nearest(glucose, c.at + m * MIN, 6 * MIN);
      if (g && c.at + m * MIN >= next && c.at + m * MIN < tailEnd && g.at >= next && g.at < tailEnd) tail.push([m, g.mgdl]);
    }
    const iobWin = windowOf(iob, c.at, end);
    const owin = windowOf(glucose, c.at, observedEnd);
    const lowMgdl = Math.min(...owin.map((g) => g.mgdl));
    const highMgdl = Math.max(...owin.map((g) => g.mgdl));
    recent.push({
      id: `${c.at}`,
      at: c.at,
      when: whenLabel(c.at),
      name: c.name?.trim() || 'Carbs',
      carbsG: Math.round(c.grams),
      bolusU: Math.round(boluses.filter((b) => Math.abs(b.at - c.at) <= 15 * MIN && b.at < next).reduce((t, b) => t + b.units, 0) * 100) / 100,
      enteredMin: c.absorptionMin,
      observedMin: input.absorbed?.get(absorbKey(c.at, c.grams))?.observedMin ?? null,
      observedByGlucose: input.absorbed?.get(absorbKey(c.at, c.grams))?.byObserved ?? false,
      riseMin: input.absorbed?.get(absorbKey(c.at, c.grams))?.riseMin ?? null,
      backMin: back ? Math.round((back.at - c.at) / MIN) : null,
      startMgdl: start.mgdl,
      peakMgdl: peak.mgdl,
      peakAfterMin: Math.round((peak.at - c.at) / MIN),
      riseMgdl: peak.mgdl - start.mgdl,
      at2hMgdl: c.at + 120 * MIN < observedEnd ? nearest(owin, c.at + 120 * MIN, 10 * MIN)?.mgdl ?? null : null,
      iobAtEntryU: nearest(iob, c.at, 10 * MIN)?.u ?? null,
      iobPeakU: iobWin.length ? Math.max(...iobWin.map((x) => x.u)) : null,
      lowMgdl,
      highMgdl,
      ...outcomeOf(lowMgdl, highMgdl),
      curve,
      tail,
      splitMin: next < c.at + WINDOW_MIN * MIN ? Math.round((next - c.at) / MIN) : null,
      adds: sitting[i].adds,
    });
  });
  const byName = new Map<string, MealResponse[]>();
  for (const m of recent) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  const groups: MealGroup[] = [...byName].map(([name, ms]) => {
    const obs = ms.map((m) => m.observedMin).filter((v): v is number => v != null);
    const bk = ms.map((m) => m.backMin).filter((v): v is number => v != null);
    const ent = ms.map((m) => m.enteredMin).filter((v): v is number => v != null);
    return {
      name,
      n: ms.length,
      medianCarbsG: Math.round(median(ms.map((m) => m.carbsG)) ?? 0),
      medianRiseMgdl: Math.round(median(ms.map((m) => m.riseMgdl)) ?? 0),
      medianPeakAfterMin: Math.round(median(ms.map((m) => m.peakAfterMin)) ?? 0),
      medianEnteredMin: ent.length ? Math.round(median(ent)!) : null,
      medianObservedMin: obs.length ? Math.round(median(obs)!) : null,
      observedN: obs.length,
      medianBackMin: bk.length ? Math.round(median(bk)!) : null,
      backN: bk.length,
      outcomes: {
        in: ms.filter((m) => m.outcome === 'in').length,
        high: ms.filter((m) => m.outcome === 'high').length,
        low: ms.filter((m) => m.outcome === 'low').length,
      },
      buckets: Object.fromEntries(BUCKETS.map((b) => [b, ms.filter((m) => (m.outcome === 'in' ? 'in' : `${m.outcome}${m.tier}`) === b).length])) as Record<Bucket, number>,
    };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { recent: recent.reverse(), groups, days: Math.round((to - from) / (24 * 60 * MIN)) };
}

/** "3h" / "2h 30m" / "45m" */
export const dur = (min: number | null) => (min == null ? '—' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`);

export interface CurveBand { t: number; p25: number; p50: number; p75: number; n: number }

/**
 * One food's glucose after it, summarized every 10 minutes: the median and the
 * middle half (25th–75th) of every time it was eaten. A point needs at least
 * `minN` meals still reading at that minute (a curve stops at the next separate meal),
 * so the line ends where the evidence thins out.
 */
export function curveBands(meals: readonly Pick<MealResponse, 'curve'>[], minN = 2): CurveBand[] {
  const at = new Map<number, number[]>();
  for (const m of meals) for (const [t, g] of m.curve) (at.get(t) ?? at.set(t, []).get(t)!).push(g);
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo));
  };
  const out: CurveBand[] = [];
  for (const t of [...at.keys()].sort((a, b) => a - b)) {
    const xs = at.get(t)!;
    if (xs.length < minN) break;
    out.push({ t, p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75), n: xs.length });
  }
  return out;
}

/** The deepest each side went across every time a food was eaten (10-minute readings), and how many times reached that tier. */
export interface Excursion { tier: Tier; extreme: number | null; times: number }
export function excursions(meals: readonly Pick<MealResponse, 'curve'>[]): { low: Excursion; high: Excursion; of: number } {
  const side = (tierOf: (g: number) => Tier, better: (a: number, b: number) => boolean): Excursion => {
    let tier: Tier = 0;
    let extreme: number | null = null;
    const per = meals.map((m) => {
      let t: Tier = 0;
      for (const [, g] of m.curve) {
        if (extreme === null || better(g, extreme)) extreme = g;
        if (tierOf(g) > t) t = tierOf(g);
      }
      if (t > tier) tier = t;
      return t;
    });
    return { tier, extreme, times: tier === 0 ? 0 : per.filter((t) => t === tier).length };
  };
  return { low: side(lowTier, (a, b) => a < b), high: side(highTier, (a, b) => a > b), of: meals.length };
}
