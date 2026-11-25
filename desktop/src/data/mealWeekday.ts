// A food by day of the week (Nov 24): when a food keeps going low or high, is it
// the food, the food on one weekday, or that weekday whatever was eaten?
//   meal          it goes out of range most times, about the same on every weekday
//   meal+weekday  one weekday's times go out far more than the rest, and that
//                 weekday's hours after the meal are NOT usually out of range on
//                 other days' food (the weekday grid): the two together
//   weekday       that weekday's hours after the meal run out of range in general
//                 (the grid), so the day is the stronger thread, not this food
//   none          no weekday stands out, or too few times to say
// Observations only (SAFE-1) and never a cause (SAFE-4): "seen alongside", not "because of".
import type { MealResponse } from './meals';

export const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The few fields this reads from a time the food was eaten. */
export type WeekdayMeal = Pick<MealResponse, 'at' | 'outcome' | 'peakMgdl' | 'lowMgdl'>;

export interface WeekdayRow {
  weekday: number;
  n: number;
  low: number;
  high: number;
  inRange: number;
  /** Median peak, mg/dL. */
  peak: number | null;
}

/** How often an hour of a weekday runs out of range, from the weekday grid (any food). */
export interface HourShare { lowPct: number | null; highPct: number | null }
export type WeekdayHours = (weekday: number, hour: number) => HourShare | null;

export type TrendKind = 'meal' | 'meal+weekday' | 'weekday' | 'none' | 'few';
export interface WeekdayTrend { kind: TrendKind; weekday: number | null; side: 'low' | 'high' | null; note: string }

/** Fewer times than this and it says there isn't enough to tell. */
export const MIN_TIMES = 4;
/** A weekday needs this many times of its own to stand out. */
export const MIN_ON_DAY = 2;
/** How much more often one weekday's times go out of range than the rest's, as a share. */
export const STANDS_OUT = 0.5;
/** "Most times": the share out of range for a food-wide trend. */
export const MOSTLY = 0.6;
/** A weekday hour runs low in general at this share of readings (the heads-up bar), or high at the high one. */
export const GRID_LOW = 10;
export const GRID_HIGH = 25;

const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export function weekdayRows(meals: readonly WeekdayMeal[]): WeekdayRow[] {
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const on = meals.filter((m) => new Date(m.at).getDay() === weekday);
    return {
      weekday,
      n: on.length,
      low: on.filter((m) => m.outcome === 'low').length,
      high: on.filter((m) => m.outcome === 'high').length,
      inRange: on.filter((m) => m.outcome === 'in').length,
      peak: median(on.map((m) => m.peakMgdl)),
    };
  });
}

const out = (r: Pick<WeekdayRow, 'low' | 'high'>) => r.low + r.high;
const sideOf = (r: Pick<WeekdayRow, 'low' | 'high'>): 'low' | 'high' => (r.low >= r.high ? 'low' : 'high');
const word = (side: 'low' | 'high', lowAt: number, highAt: number) => (side === 'low' ? `below ${lowAt}` : `above ${highAt}`);

/**
 * Reads which thread a food's trend follows. `hours` answers how a weekday's hours run on any food;
 * pass null when the grid isn't available and the day-wide check is skipped. Pure.
 */
export function weekdayTrend(meals: readonly WeekdayMeal[], hours: WeekdayHours | null, bands: { low: number; high: number }, food: string): WeekdayTrend {
  const rows = weekdayRows(meals);
  const total = meals.length;
  const days = rows.filter((r) => r.n > 0).length;
  if (total < MIN_TIMES || days < 2) {
    return { kind: 'few', weekday: null, side: null, note: `${total} ${total === 1 ? 'time' : 'times'} on ${days} ${days === 1 ? 'weekday' : 'weekdays'} so far: too few to tell whether a trend follows ${food} or the day.` };
  }
  // The weekday whose times went out of range most, against all the other times.
  let best: { r: WeekdayRow; rate: number; rest: number } | null = null;
  for (const r of rows) {
    if (r.n < MIN_ON_DAY) continue;
    const restN = total - r.n;
    if (restN < MIN_ON_DAY) continue;
    const rate = out(r) / r.n;
    const rest = (rows.reduce((t, x) => t + out(x), 0) - out(r)) / restN;
    if (rate - rest >= STANDS_OUT && (!best || rate - rest > best.rate - best.rest)) best = { r, rate, rest };
  }
  if (best) {
    const side = sideOf(best.r);
    const w = WD[best.r.weekday];
    // Is that weekday out of range anyway, in the hours after this food is usually eaten?
    const hoursAfter = meals.filter((m) => new Date(m.at).getDay() === best!.r.weekday).map((m) => new Date(m.at).getHours());
    const usual = median(hoursAfter) ?? 12;
    const span = [0, 1, 2, 3, 4].map((h) => hours?.(best!.r.weekday, (usual + h) % 24) ?? null).filter((c): c is HourShare => c != null);
    const dayWide = span.some((c) => (side === 'low' ? (c.lowPct ?? 0) >= GRID_LOW : (c.highPct ?? 0) >= GRID_HIGH));
    const these = `${out(best.r)} of ${best.r.n} ${w} times went ${word(side, bands.low, bands.high)}, against ${Math.round(best.rest * 100)}% of the other ${total - best.r.n}`;
    return dayWide
      ? { kind: 'weekday', weekday: best.r.weekday, side, note: `${these}. Other foods on ${w}s run ${side} at those hours too, so the day looks like the stronger thread than ${food}.` }
      : { kind: 'meal+weekday', weekday: best.r.weekday, side, note: `${these}. Other foods on ${w}s don’t run ${side} at those hours, so it’s ${food} on a ${w} together that stands out.` };
  }
  const outAll = rows.reduce((t, r) => t + out(r), 0);
  if (outAll / total >= MOSTLY) {
    const lows = rows.reduce((t, r) => t + r.low, 0), highs = rows.reduce((t, r) => t + r.high, 0);
    const side = lows >= highs ? 'low' : 'high';
    const main = side === 'low' ? lows : highs, other = side === 'low' ? highs : lows;
    const also = other ? ` (and ${other} ${word(side === 'low' ? 'high' : 'low', bands.low, bands.high)})` : '';
    return { kind: 'meal', weekday: null, side, note: `${main} of ${total} times went ${word(side, bands.low, bands.high)}${also}, spread across ${days} weekdays: it follows ${food} rather than any one day.` };
  }
  return { kind: 'none', weekday: null, side: null, note: `No weekday stands out: ${food} goes about the same whichever day it’s eaten.` };
}
