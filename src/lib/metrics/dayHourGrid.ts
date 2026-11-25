import type { GlucoseReading, WorkoutEntry, CarbEntry } from '@/data/sources/types';
import type { TargetRange } from '@/data/loopTherapyStore';

// What a given weekday usually does, hour by hour.
//
// computeRiskWindows already builds exactly this table — a 7×24 grid of cells,
// each holding per-week counts — and then throws it away once it has extracted
// the handful of windows worth alerting on. The grid is the more useful object:
// a risk window is one cell that crossed a threshold, while the grid is the
// whole shape of a Tuesday, including the parts that are fine.
//
// The evidence rule is the one the rest of the app uses: THE WEEK IS THE UNIT.
// Twelve readings from one bad Tuesday are one Tuesday, not twelve data points.
// A cell only counts a week that carried enough readings to have an opinion,
// and a claim about an hour needs several such weeks behind it. Without that,
// six months of data reads as 26 independent observations per hour when it is
// really 26 samples of the same recurring hour — which is exactly the
// difference between "this happens on Tuesdays" and "this happened once".

export const WEEKDAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Readings a week needs in an hour before that week may vote on it. */
export const MIN_READINGS_PER_CELL_WEEK = 6;

/** Weeks that must have voted before a cell says anything at all. */
export const MIN_WEEKS_PER_CELL = 3;

/**
 * How far back the weekday picture looks. Twelve weeks is enough Tuesdays to
 * call something a pattern, and recent enough that a pattern settings changes
 * fixed two months ago stops being reported as current.
 */
export const PATTERN_SAMPLE_WEEKS = 12;

export type HourCell = {
  hour: number;
  /** Weeks with enough readings in this hour to have an opinion. */
  weeksVoted: number;
  /** Local hour occurrences for the desktop drill-down. Includes partial hours. */
  samples?: { firstIso: string; count: number; below: number; above: number; medianMgdl: number }[];
  /** Median of each voting week's median — robust to one wild week. */
  medianMgdl: number | null;
  /** Share of readings in range, across voting weeks. */
  inRangePct: number | null;
  lowPct: number | null;
  highPct: number | null;
  /** Weeks where this hour dipped below the low bound at all. */
  weeksWithLow: number;
  /** Weeks where it went above the high bound. */
  weeksWithHigh: number;
  /**
   * Median change across the hour, mg/dL. Positive = climbing.
   * This is the number that makes "80 at 8, 120 at 9, 150 at 10" legible as a
   * climb rather than three unrelated figures.
   */
  medianDeltaMgdl: number | null;
  /** Median exercise minutes recorded in this hour, across voting weeks. */
  exerciseMinutes: number;
  /** Weeks where a workout overlapped this hour. */
  weeksWithWorkout: number;
  /** Most common workout type overlapping this hour, when there is one. */
  workoutType: string | null;
  /** Median carbs logged in this hour, across weeks that logged any. */
  carbsG: number;
  /** True once enough weeks have voted to make a claim. */
  reliable: boolean;
};

export type DayProfile = {
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
  label: string;
  hours: HourCell[];
  /** Distinct weeks that contributed any reading to this weekday. */
  weeksObserved: number;
};

export type DayHourGrid = {
  days: DayProfile[];
  weeksObserved: number;
  /** The band every percentage here was scored against. */
  targetLowMgdl: number;
  targetHighMgdl: number;
};

/** ISO-ish week key, Monday-first, matching riskWindows.ts. */
function weekKey(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - day);
  return `${copy.getFullYear()}-${copy.getMonth()}-${copy.getDate()}`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type WeekBucket = {
  values: number[];
  inRange: number;
  low: number;
  high: number;
  first: { ms: number; mgdl: number } | null;
  last: { ms: number; mgdl: number } | null;
  exerciseMin: number;
  workoutTypes: string[];
  carbsG: number;
};

function emptyWeek(): WeekBucket {
  return {
    values: [], inRange: 0, low: 0, high: 0,
    first: null, last: null, exerciseMin: 0, workoutTypes: [], carbsG: 0,
  };
}

function mode(xs: string[]): string | null {
  if (xs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Build the weekday × hour picture.
 *
 * Everything is accumulated per (weekday, hour, WEEK) first and only then
 * reduced across weeks, so one heavy week cannot outvote five ordinary ones —
 * which a straight average over readings would let it do.
 */
export function computeDayHourGrid(input: {
  glucose: GlucoseReading[];
  target: TargetRange;
  now: Date;
  workouts?: WorkoutEntry[];
  /** Hourly exercise minutes, as produced by the hour-bucketed HealthKit read. */
  exerciseByHour?: { iso: string; minutes: number }[];
  carbs?: CarbEntry[];
  /** Only the last this-many weeks count. Omit to use everything passed in. */
  weeks?: number;
  includeSamples?: boolean;
}): DayHourGrid {
  const { target, now } = input;
  const fromMs = input.weeks != null ? now.getTime() - input.weeks * 7 * 24 * 3600_000 : -Infinity;

  // [weekday][hour] -> weekKey -> bucket
  const cells: Map<string, WeekBucket>[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => new Map<string, WeekBucket>()),
  );
  const weeksPerDay: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  const allWeeks = new Set<string>();

  const bucketFor = (d: Date): WeekBucket => {
    const wk = weekKey(d);
    const day = d.getDay();
    const hour = d.getHours();
    allWeeks.add(wk);
    weeksPerDay[day].add(wk);
    const map = cells[day][hour];
    let b = map.get(wk);
    if (!b) { b = emptyWeek(); map.set(wk, b); }
    return b;
  };

  for (const r of input.glucose) {
    const t = new Date(r.iso).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(r.mgdl) || t < fromMs || t > now.getTime()) continue;
    const d = new Date(t);
    const b = bucketFor(d);
    b.values.push(r.mgdl);
    if (r.mgdl < target.lowMgdl) b.low += 1;
    else if (r.mgdl > target.highMgdl) b.high += 1;
    else b.inRange += 1;
    if (!b.first || t < b.first.ms) b.first = { ms: t, mgdl: r.mgdl };
    if (!b.last || t > b.last.ms) b.last = { ms: t, mgdl: r.mgdl };
  }

  for (const e of input.exerciseByHour ?? []) {
    const t = new Date(e.iso).getTime();
    if (!Number.isFinite(t) || t < fromMs || t > now.getTime() || !(e.minutes > 0)) continue;
    bucketFor(new Date(t)).exerciseMin += e.minutes;
  }

  // A workout is a span, so it annotates every hour it overlaps — a 45-minute
  // ride starting at 8:50 belongs to both 8am and 9am.
  for (const w of input.workouts ?? []) {
    const s = new Date(w.startTime).getTime();
    const e = new Date(w.endTime).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < fromMs) continue;
    for (let t = s; t < Math.min(e, now.getTime()); t += 3600_000) {
      bucketFor(new Date(t)).workoutTypes.push(w.type);
    }
    // Ensure the final partial hour is counted too.
    const lastHour = new Date(Math.min(e - 1, now.getTime()));
    if (lastHour.getTime() >= s) bucketFor(lastHour).workoutTypes.push(w.type);
  }

  for (const c of input.carbs ?? []) {
    const t = new Date(c.iso).getTime();
    if (!Number.isFinite(t) || t < fromMs || t > now.getTime() || !(c.grams > 0)) continue;
    bucketFor(new Date(t)).carbsG += c.grams;
  }

  const days: DayProfile[] = [];
  for (let day = 0; day < 7; day += 1) {
    const hours: HourCell[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const weeks = [...cells[day][hour].values()];
      // Only weeks with enough readings get a vote. A week that contributed two
      // readings to an hour has not observed that hour.
      const voting = weeks.filter((w) => w.values.length >= MIN_READINGS_PER_CELL_WEEK);
      const weeksVoted = voting.length;
      const reliable = weeksVoted >= MIN_WEEKS_PER_CELL;

      const perWeekMedians = voting
        .map((w) => median(w.values))
        .filter((v): v is number => v != null);
      const totalReadings = voting.reduce((a, w) => a + w.values.length, 0);
      const deltas = voting
        .map((w) => (w.first && w.last ? w.last.mgdl - w.first.mgdl : null))
        .filter((v): v is number => v != null);

      const workoutWeeks = voting.filter((w) => w.workoutTypes.length > 0);
      const exerciseWeeks = voting.filter((w) => w.exerciseMin > 0);
      const carbWeeks = voting.filter((w) => w.carbsG > 0);

      hours.push({
        hour,
        weeksVoted,
        ...(input.includeSamples && { samples: weeks.filter(w => w.first).map(w => ({
          firstIso: new Date(w.first!.ms).toISOString(),
          count: w.values.length,
          below: w.low,
          above: w.high,
          medianMgdl: Math.round(median(w.values)!),
        })).sort((a, b) => b.firstIso.localeCompare(a.firstIso)) }),
        reliable,
        medianMgdl: reliable ? Math.round(median(perWeekMedians) ?? 0) : null,
        inRangePct:
          reliable && totalReadings > 0
            ? Math.round((voting.reduce((a, w) => a + w.inRange, 0) / totalReadings) * 100)
            : null,
        lowPct:
          reliable && totalReadings > 0
            ? Math.round((voting.reduce((a, w) => a + w.low, 0) / totalReadings) * 100)
            : null,
        highPct:
          reliable && totalReadings > 0
            ? Math.round((voting.reduce((a, w) => a + w.high, 0) / totalReadings) * 100)
            : null,
        weeksWithLow: voting.filter((w) => w.low > 0).length,
        weeksWithHigh: voting.filter((w) => w.high > 0).length,
        medianDeltaMgdl: reliable ? Math.round(median(deltas) ?? 0) : null,
        exerciseMinutes: Math.round(median(exerciseWeeks.map((w) => w.exerciseMin)) ?? 0),
        weeksWithWorkout: workoutWeeks.length,
        workoutType: mode(workoutWeeks.flatMap((w) => w.workoutTypes)),
        carbsG: Math.round(median(carbWeeks.map((w) => w.carbsG)) ?? 0),
      });
    }
    days.push({
      weekday: day,
      label: WEEKDAY_LABELS[day],
      hours,
      weeksObserved: weeksPerDay[day].size,
    });
  }

  return {
    days,
    weeksObserved: allWeeks.size,
    targetLowMgdl: target.lowMgdl,
    targetHighMgdl: target.highMgdl,
  };
}
