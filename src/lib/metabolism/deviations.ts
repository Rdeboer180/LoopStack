import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { valueAt } from '@/data/loopTherapy';
import {
  activityAt,
  modelFromTherapy,
  netInsulinImpulses,
  type InsulinModel,
} from './insulinActivity';

// Deviations: what glucose did, minus what the insulin explains.
//
// This is the measurement both Autosens and Autotune are built on. For each
// five-minute step:
//
//   BGI       = -(insulin acting per minute) x ISF x 5     — the drop insulin accounts for
//   deviation = (actual BG change) - BGI                   — everything insulin does NOT explain
//
// A deviation of zero means glucose moved exactly as the insulin on board
// predicted. Positive means something pushed it up — food, an under-covered
// basal hour, a rebound. Negative means it fell further than insulin explains.
//
// Categorising those deviations is what separates the two questions:
//   - deviations while food is absorbing say something about carb ratio
//   - deviations with no food in play say something about basal and ISF
//
// Mixing the two is the classic error: an unlogged meal that lands in the basal
// bucket reads as "your basal is too low" forever. That is why the exclusions
// below are deliberately aggressive, and why every consumer of this module is
// expected to gate on how complete the carb logging actually was.

/** CGM cadence. Every deviation is normalised to this step. */
export const STEP_MINUTES = 5;

/** Gap beyond which two readings are not treated as consecutive. A missing
 *  sensor hour must not become one enormous fabricated deviation. */
const MAX_GAP_MINUTES = 12;

/** Minutes after a carb entry that are excluded outright. Early post-meal
 *  movement is dominated by absorption onset and says nothing usable about
 *  insulin sensitivity. oref0 uses the same 45-minute blackout. */
export const CARB_BLACKOUT_MINUTES = 45;

/** Rise per step, in mg/dL, above which an unannounced meal is suspected while
 *  no carbs are logged. Two per five minutes is 24 mg/dL an hour — well above
 *  sensor wobble, well below what any real meal produces. */
const UAM_RISE_MGDL = 2;

/** Consecutive rising steps required before a meal is suspected. A single step
 *  over the threshold is noise; a meal keeps pushing. Without this, ordinary
 *  sensor jitter would quarantine chunks of otherwise clean overnight data. */
const UAM_MIN_CONSECUTIVE = 2;

/** How long a suspected unannounced meal keeps excluding steps. */
const UAM_SHADOW_MINUTES = 180;

/** Carb absorption floor, in mg/dL per 5 min. oref0 calls this
 *  min_5m_carbimpact: carbs on board are force-decayed at this rate even when
 *  glucose is flat or falling, because otherwise a meal that never showed up in
 *  the data would keep COB above zero indefinitely. */
export const MIN_5M_CARBIMPACT = 8;

export type DeviationBucket = 'csf' | 'basal' | 'uam' | 'blackout';

export type DeviationStep = {
  ms: number;
  /** Local hour the step falls in — Autotune's basal buckets key off this. */
  hour: number;
  /** Observed change in mg/dL across the step. */
  bgDelta: number;
  /** mg/dL the insulin on board accounts for. Negative when insulin is acting. */
  bgi: number;
  /** bgDelta − bgi. The part insulin does not explain. */
  deviation: number;
  /** Carbs on board at the step, in grams. */
  cob: number;
  /** ISF in force at the step, from the schedule. */
  isf: number;
  bucket: DeviationBucket;
};

export type DeviationSet = {
  steps: DeviationStep[];
  /** Steps that survived every exclusion — the ones basal and ISF are read from. */
  cleanSteps: DeviationStep[];
  /** Steps taken while food was demonstrably absorbing. */
  carbSteps: DeviationStep[];
  model: InsulinModel;
};

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Carbs on board over time, decayed at the observed rate but never slower than
 * the floor.
 *
 * The floor is the important half. Without it, a meal logged as 80 g that only
 * ever produced 30 g worth of rise would leave COB pinned above zero for the
 * rest of the day, and every later step would be excluded as "still absorbing"
 * — silently starving the basal analysis of data on exactly the days when carb
 * logging was worst.
 */
export function carbsOnBoardAt(
  atMs: number,
  carbs: CarbEntry[],
  csf: number,
): number {
  let cob = 0;
  for (const c of carbs) {
    const t = ms(c.iso);
    if (!Number.isFinite(t) || t > atMs) continue;
    const minutesSince = (atMs - t) / 60_000;
    const absorptionMinutes = Math.max(c.absorptionHours ?? 3, 1) * 60;
    if (minutesSince >= absorptionMinutes) continue;

    // Two decay estimates; the faster one wins.
    const linearRemaining = c.grams * (1 - minutesSince / absorptionMinutes);
    const flooredDecayGrams = (minutesSince / STEP_MINUTES) * (MIN_5M_CARBIMPACT / csf);
    const flooredRemaining = c.grams - flooredDecayGrams;

    const remaining = Math.min(linearRemaining, flooredRemaining);
    if (remaining > 0) cob += remaining;
  }
  return cob;
}

/**
 * Carb sensitivity factor — mg/dL of rise per gram of carb.
 *
 * Seeded closed-form as ISF / carb-ratio: if one unit drops you 42 mg/dL and
 * covers 14 g, then one gram is worth 3 mg/dL. This is the seed Autotune then
 * revises against observed post-meal rise.
 */
export function seedCsf(isf: number, carbRatio: number): number {
  if (carbRatio <= 0) return 0;
  return isf / carbRatio;
}

/** Mean ISF across the schedule — Autotune tunes one flat ISF, not a curve. */
export function flatIsf(therapy: LoopTherapy): number {
  return weightedScheduleMean(therapy.insulinSensitivitySchedule);
}

/** Mean carb ratio across the schedule, flattened for the same reason. */
export function flatCarbRatio(therapy: LoopTherapy): number {
  return weightedScheduleMean(therapy.carbRatioSchedule);
}

/** Duration-weighted mean of a time-segmented schedule over 24 h. */
function weightedScheduleMean(schedule: { startMinutes: number; value: number }[]): number {
  if (schedule.length === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < schedule.length; i += 1) {
    const start = schedule[i].startMinutes;
    const end = i + 1 < schedule.length ? schedule[i + 1].startMinutes : 24 * 60;
    weighted += schedule[i].value * (end - start);
  }
  return +(weighted / (24 * 60)).toFixed(2);
}

export function computeDeviations(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  peakMinutes?: number;
}): DeviationSet {
  const { therapy, carbs } = input;
  const model = modelFromTherapy(therapy, input.peakMinutes);
  const impulses = netInsulinImpulses(input.insulin, therapy);
  const csf = seedCsf(flatIsf(therapy), flatCarbRatio(therapy)) || 1;

  const glucose = [...input.glucose]
    .filter((g) => Number.isFinite(ms(g.iso)) && g.mgdl > 0)
    .sort((a, b) => ms(a.iso) - ms(b.iso));

  // Carbs in time order with their times parsed once. Each step only looks at the
  // entries that can still matter (a sliding window), so months of history stay fast;
  // the result is the same as scanning every entry.
  const carbsByTime = carbs
    .map((c) => ({ c, t: ms(c.iso) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const lookbackMs =
    Math.max(
      UAM_SHADOW_MINUTES,
      CARB_BLACKOUT_MINUTES,
      ...carbsByTime.map((x) => Math.max(x.c.absorptionHours ?? 3, 1) * 60),
      0,
    ) * 60_000;
  let winLo = 0;
  let winHi = 0;

  const steps: DeviationStep[] = [];
  let uamUntilMs = 0;
  let consecutiveRises = 0;

  for (let i = 1; i < glucose.length; i += 1) {
    const prev = glucose[i - 1];
    const cur = glucose[i];
    const gapMinutes = (ms(cur.iso) - ms(prev.iso)) / 60_000;
    if (gapMinutes <= 0 || gapMinutes > MAX_GAP_MINUTES) continue;

    const atMs = ms(cur.iso);
    const d = new Date(atMs);
    const minuteOfDay = d.getHours() * 60 + d.getMinutes();
    const isf = valueAt(therapy.insulinSensitivitySchedule, minuteOfDay);

    // Insulin's contribution, normalised to the actual gap so a 6-minute step
    // is not credited with 5 minutes of insulin action.
    const activityPerMin = activityAt(atMs, impulses, model);
    const bgi = -(activityPerMin * isf * gapMinutes);

    const rawDelta = cur.mgdl - prev.mgdl;
    // Normalise to a 5-minute step so deviations from uneven CGM spacing are
    // comparable — a percentile over mixed step sizes is meaningless otherwise.
    const scale = STEP_MINUTES / gapMinutes;
    const bgDelta = rawDelta * scale;
    const deviation = bgDelta - bgi * scale;

    while (winHi < carbsByTime.length && carbsByTime[winHi].t <= atMs) winHi += 1;
    while (winLo < winHi && carbsByTime[winLo].t < atMs - lookbackMs) winLo += 1;
    const near = carbsByTime.slice(winLo, winHi);
    const cob = carbsOnBoardAt(atMs, near.map((x) => x.c), csf);

    // Unannounced meals: a sustained rise with no carbs on board and none
    // logged recently. Left in the basal bucket these read as chronic
    // under-basal, which is the single most common way retrospective tuning
    // goes wrong.
    const recentCarb = near.some(
      ({ t }) => atMs - t >= 0 && atMs - t <= UAM_SHADOW_MINUTES * 60_000,
    );
    if (cob <= 0 && !recentCarb && deviation >= UAM_RISE_MGDL) {
      consecutiveRises += 1;
      if (consecutiveRises >= UAM_MIN_CONSECUTIVE) {
        uamUntilMs = Math.max(uamUntilMs, atMs + UAM_SHADOW_MINUTES * 60_000);
      }
    } else {
      consecutiveRises = 0;
    }

    const inBlackout = near.some(
      ({ t }) => atMs - t >= 0 && atMs - t <= CARB_BLACKOUT_MINUTES * 60_000,
    );

    // Carbs on board wins over the blackout, and the order matters a great
    // deal. The 45-minute blackout exists to keep early post-meal movement out
    // of the *basal and ISF* reads — but that early stretch is where most of a
    // meal's rise actually lands. Excluding it from the carb bucket too would
    // divide a truncated rise by the full grams eaten and make every meal look
    // far weaker than it was. So blackout now only catches the odd case of a
    // carb entry whose COB has already decayed to nothing.
    let bucket: DeviationBucket;
    if (cob > 0) bucket = 'csf';
    else if (inBlackout) bucket = 'blackout';
    else if (atMs <= uamUntilMs) bucket = 'uam';
    else bucket = 'basal';

    steps.push({
      ms: atMs,
      hour: d.getHours(),
      bgDelta: +bgDelta.toFixed(2),
      bgi: +(bgi * scale).toFixed(2),
      deviation: +deviation.toFixed(2),
      cob: +cob.toFixed(1),
      isf,
      bucket,
    });
  }

  return {
    steps,
    cleanSteps: steps.filter((s) => s.bucket === 'basal'),
    carbSteps: steps.filter((s) => s.bucket === 'csf'),
    model,
  };
}

/** Percentile of a numeric list, linearly interpolated. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
