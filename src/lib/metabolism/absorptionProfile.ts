import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import {
  modelImpactFraction,
  modelKindForEntry,
  modelKindLabel,
  modelPeakWindowFractions,
  type AbsorptionModelKind,
} from './carbAbsorption';
import { combineCarbEntries } from './mealCombining';
import {
  computeDeviations,
  flatCarbRatio,
  flatIsf,
  percentile,
  seedCsf,
  STEP_MINUTES,
} from './deviations';

// Observed carb absorption, per preset and per food.
//
// Loop asks for an absorption time with every carb entry, and the presets you
// pick (3 h, 4 h, 6 h) are guesses about how a plate behaves. This module turns
// history into the measured answer: for every meal that can be read cleanly,
// how fast did the glucose impact actually arrive, when did it peak, and when
// was it effectively done — compared against the piecewise curve the preset
// told Loop to expect.
//
// The measurement is the deviation stream with insulin netted out. What is
// left after subtracting modelled insulin activity is, for a cleanly isolated
// meal, the food's own impact (plus model noise — which is exactly why every
// figure here is a median across meals, never a single trace).
//
// Entries within two hours of each other are ONE sitting — combined grams,
// grams-weighted absorption — because the second helping and the dessert share
// the first plate's curve by design, not by accident. Beyond two hours a meal
// is only read when it stands alone: a trace that overlaps a genuinely
// separate meal belongs to both plates, and attributing it to either corrupts
// the preset it was logged under. Those are counted and excluded, and the
// exclusion is shown rather than hidden.
//
// Output is pattern support for CARB ENTRIES — which preset a plate behaves
// like. It never mentions insulin amounts, and the absorption preset itself
// remains a choice made in Loop.

/** Observation horizon as a multiple of the preset duration — long enough to
 *  see impact that outlasts the preset, short enough to stay clean. */
const HORIZON_FACTOR = 1.5;

/** A window shorter than this share of the preset can't say when the meal
 *  finished, so the meal is skipped rather than half-read. */
const MIN_WINDOW_FACTOR = 0.75;

/** Meals below this are corrections and snacks, not readable absorption. */
const MIN_GRAMS = 15;

/** Total observed rise below which per-meal timing stats are meaningless. */
const MIN_TOTAL_RISE_MGDL = 20;

/** Share of expected CGM steps a window must actually have. */
const MIN_COVERAGE = 0.7;

/** Clean meals a preset needs before its verdict is stated. */
export const MIN_MEALS_PER_PRESET = 5;

/** Clean meals a food label needs before it gets a row. */
export const MIN_MEALS_PER_FOOD = 3;

/** Presets with fewer than this many logged meals are noise, not presets. */
const MIN_LOGGED_PER_PRESET = 3;

const ms = (iso: string) => new Date(iso).getTime();

export type ObservedMeal = {
  iso: string;
  grams: number;
  label?: string;
  /** Carb entries combined into this sitting. 1 = a plain meal. */
  entryCount: number;
  presetHours: number;
  /** The curve the fork graded this entry against, from its label marker. */
  modelKind: AbsorptionModelKind;
  /** Minutes the meal could actually be watched. */
  observedMinutes: number;
  /** True when the next meal cut the window short of the full horizon. */
  truncated: boolean;
  /** Smoothed minutes to peak impact. Null when the rise was too small. */
  minutesToPeak: number | null;
  minutesTo50: number | null;
  /** Minutes until ~90% of the observed impact had arrived. Null when the
   *  window ended first — the signature of a meal outlasting its preset. */
  minutesTo90: number | null;
  /** Sum of positive deviations across the window. */
  totalRiseMgdl: number;
  /** What the rise was worth in grams, at the current carb sensitivity. */
  impliedGrams: number | null;
  /** Cumulative fraction of observed impact per 5-minute step from the meal. */
  cumulative: number[];
};

export type PresetVerdict = 'matches' | 'finishes_early' | 'outlasts' | 'building';

export type PresetGroup = {
  presetHours: number;
  presetMinutes: number;
  /** The curve these entries are graded against. Marked entries (🥜/🍲) are
   *  individual cases with their own card, never mixed with plain entries of
   *  the same duration. */
  modelKind: AbsorptionModelKind;
  /** Human name for that curve, for cards and the export. */
  modelLabel: string;
  /** Meals read cleanly. */
  mealCount: number;
  /** Every meal logged under this preset in the window. */
  loggedCount: number;
  medianMinutesToPeak: number | null;
  medianMinutesTo50: number | null;
  /** Median effective done-time. Truncation-aware: unfinished meals count at
   *  their window end, so this is a floor when `stillGoingShare` is high. */
  medianMinutesTo90: number | null;
  /** Share of clean meals still showing impact when their window closed. */
  stillGoingSharePct: number;
  /** The window the model says impact should peak in: 15–50% of the preset. */
  modeledPeakStart: number;
  modeledPeakEnd: number;
  /** When the model says 90% has arrived. */
  modeledMinutesTo90: number;
  /** Median observed vs modelled cumulative %, per 5-min step, for the chart. */
  curve: { minute: number; observedPct: number; modeledPct: number }[];
  verdict: PresetVerdict;
  note: string;
  /** Median of implied ÷ logged grams, as a percentage. */
  impliedVsLoggedPct: number | null;
};

export type FoodGroup = {
  label: string;
  mealCount: number;
  medianGrams: number;
  /** The preset these meals were most often logged under. */
  loggedPresetHours: number;
  medianMinutesToPeak: number | null;
  medianMinutesTo90: number | null;
  /** Which of the user's presets the observed done-time actually tracks. */
  closestPresetHours: number | null;
  note: string;
};

export type AbsorptionInsights = {
  windowDays: number;
  totalMeals: number;
  cleanMeals: number;
  /** Sittings built from more than one carb entry (the 2-hour combining rule). */
  comboMeals: number;
  /** Why meals were excluded, for honesty about coverage. */
  excludedOverlapping: number;
  excludedOther: number;
  presets: PresetGroup[];
  foods: FoodGroup[];
  dataNote: string;
  /** Ready-to-paste export of everything above. */
  report: string;
};

/** Minutes at which the modelled curve reaches `fraction` of total. Defaults
 *  to the piecewise curve; marked entries pass their own kind. */
export function modeledMinutesToFraction(
  presetMinutes: number,
  fraction: number,
  kind: AbsorptionModelKind = 'piecewise',
): number {
  let cum = 0;
  for (let m = 0; m < presetMinutes; m += 1) {
    cum += modelImpactFraction(kind, m + 0.5, presetMinutes);
    if (cum >= fraction) return m + 1;
  }
  return presetMinutes;
}

/**
 * Isolate every meal that can be read on a curve of its own.
 *
 * Exported for tests; the shape of what gets excluded is as load-bearing as
 * the maths on what remains.
 */
export function observeMeals(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
}): { observed: ObservedMeal[]; excludedOverlapping: number; excludedOther: number } {
  const csf = seedCsf(flatIsf(input.therapy), flatCarbRatio(input.therapy));
  const { steps } = computeDeviations(input);
  const stepByMs = new Map(steps.map((s) => [s.ms, s]));
  // Steps are in time order: a binary search finds the one within half a step of
  // `at` (the same match a linear scan finds), so months of history stay fast.
  const nearestStep = (at: number) => {
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid].ms < at) lo = mid + 1;
      else hi = mid;
    }
    const half = (STEP_MINUTES / 2) * 60_000;
    for (const i of [lo - 1, lo]) {
      const x = steps[i];
      if (x && Math.abs(x.ms - at) < half) return x;
    }
    return undefined;
  };

  // Sittings, not raw entries: dessert ninety minutes after the plate is the
  // same physiological event, and reading it as an overlap would throw away
  // exactly the meals the combining rule exists to keep.
  const meals = combineCarbEntries(input.carbs).filter((m) => m.grams >= MIN_GRAMS);

  const observed: ObservedMeal[] = [];
  let excludedOverlapping = 0;
  let excludedOther = 0;

  for (let i = 0; i < meals.length; i += 1) {
    const meal = meals[i];
    const t = meal.timeMs;
    const presetMinutes = Math.max(30, meal.absorptionHours * 60);
    const horizon = presetMinutes * HORIZON_FACTOR;

    // A previous meal still absorbing at our start bleeds its tail into this
    // trace. 1.25 leaves margin for absorption running long.
    const prior = meals
      .slice(0, i)
      .some((p) => p.timeMs + p.absorptionHours * 3600_000 * 1.25 > t);
    if (prior) {
      excludedOverlapping += 1;
      continue;
    }

    // The next meal ends what we can attribute to this one.
    const next = meals[i + 1];
    const cutMs = next ? next.timeMs - 15 * 60_000 : Infinity;
    const windowMinutes = Math.min(horizon, (cutMs - t) / 60_000);
    if (windowMinutes < presetMinutes * MIN_WINDOW_FACTOR) {
      excludedOverlapping += 1;
      continue;
    }

    // Collect the deviation steps inside the window, aligned to 5-min offsets.
    const stepCount = Math.floor(windowMinutes / STEP_MINUTES);
    const deviations: number[] = [];
    let found = 0;
    for (let k = 1; k <= stepCount; k += 1) {
      const at = t + k * STEP_MINUTES * 60_000;
      // CGM stamps rarely land exactly on the grid; take the nearest step.
      const s = stepByMs.get(at) ?? nearestStep(at);
      if (s) {
        deviations.push(s.deviation);
        found += 1;
      } else {
        deviations.push(0);
      }
    }
    if (stepCount === 0 || found / stepCount < MIN_COVERAGE) {
      excludedOther += 1;
      continue;
    }

    // Positive deviations are the food arriving; negatives are noise and
    // insulin-model error, which the cumulative view ignores by design.
    const positives = deviations.map((d) => Math.max(0, d));
    const totalRise = positives.reduce((a, d) => a + d, 0);

    const truncated = windowMinutes < horizon - STEP_MINUTES;

    if (totalRise < MIN_TOTAL_RISE_MGDL) {
      observed.push({
        iso: meal.iso,
        grams: meal.grams,
        label: meal.label ?? undefined,
        entryCount: meal.entryCount,
        presetHours: presetMinutes / 60,
        modelKind: modelKindForEntry(meal),
        observedMinutes: Math.round(windowMinutes),
        truncated,
        minutesToPeak: null,
        minutesTo50: null,
        minutesTo90: null,
        totalRiseMgdl: +totalRise.toFixed(1),
        impliedGrams: null,
        cumulative: [],
      });
      continue;
    }

    // 15-minute centred smoothing before the peak is read — a single-step CGM
    // jump must not become "this plate peaks at 20 minutes".
    let peakIdx = 0;
    let peakVal = -Infinity;
    for (let k = 0; k < positives.length; k += 1) {
      const w =
        (positives[k - 1] ?? 0) + positives[k] + (positives[k + 1] ?? 0);
      if (w > peakVal) {
        peakVal = w;
        peakIdx = k;
      }
    }

    const cumulative: number[] = [];
    let running = 0;
    for (const d of positives) {
      running += d;
      cumulative.push(+(running / totalRise).toFixed(4));
    }
    const minutesAt = (fraction: number): number | null => {
      const idx = cumulative.findIndex((c) => c >= fraction);
      return idx === -1 ? null : (idx + 1) * STEP_MINUTES;
    };

    observed.push({
      iso: meal.iso,
      grams: meal.grams,
      label: meal.label ?? undefined,
      entryCount: meal.entryCount,
      presetHours: presetMinutes / 60,
      modelKind: modelKindForEntry(meal),
      observedMinutes: Math.round(windowMinutes),
      truncated,
      minutesToPeak: (peakIdx + 1) * STEP_MINUTES,
      minutesTo50: minutesAt(0.5),
      minutesTo90: minutesAt(0.9),
      totalRiseMgdl: +totalRise.toFixed(1),
      impliedGrams: csf > 0 ? +(totalRise / csf).toFixed(0) : null,
      cumulative,
    });
  }

  return { observed, excludedOverlapping, excludedOther };
}

function median(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length === 0) return null;
  return Math.round(percentile(xs, 0.5));
}

function buildPresetGroup(
  presetHours: number,
  modelKind: AbsorptionModelKind,
  clean: ObservedMeal[],
  loggedCount: number,
): PresetGroup {
  const presetMinutes = presetHours * 60;
  const readable = clean.filter((m) => m.minutesToPeak != null);

  // Truncation-aware done-time: a meal still going when its window closed
  // counts at the window end, making the median a floor, and the share of
  // such meals is reported alongside it.
  const effectiveT90 = readable.map((m) => m.minutesTo90 ?? m.observedMinutes);
  const stillGoing = readable.filter((m) => m.minutesTo90 == null).length;
  const stillGoingSharePct =
    readable.length > 0 ? Math.round((stillGoing / readable.length) * 100) : 0;

  const medianMinutesTo90 = median(effectiveT90);
  const medianMinutesToPeak = median(readable.map((m) => m.minutesToPeak));
  const medianMinutesTo50 = median(readable.map((m) => m.minutesTo50));

  // Every reference below comes from the curve these entries were actually
  // graded against — 🥜/🍲-marked entries carry their own knee curves.
  const modeledMinutesTo90 = modeledMinutesToFraction(presetMinutes, 0.9, modelKind);
  const peakWindow = modelPeakWindowFractions(modelKind);
  const modeledPeakStart = Math.round(presetMinutes * peakWindow.start);
  const modeledPeakEnd = Math.round(presetMinutes * peakWindow.end);

  // Median observed cumulative % per step, next to the modelled curve. Stops
  // once fewer than three meals still have data at that offset.
  const curve: PresetGroup['curve'] = [];
  const horizonSteps = Math.round((presetMinutes * HORIZON_FACTOR) / STEP_MINUTES);
  let modeledCum = 0;
  for (let k = 0; k < horizonSteps; k += 1) {
    const minute = (k + 1) * STEP_MINUTES;
    const at = readable
      .filter((m) => m.cumulative.length > k)
      .map((m) => m.cumulative[k]);
    modeledCum += modelImpactFraction(modelKind, minute - STEP_MINUTES / 2, presetMinutes) * STEP_MINUTES;
    if (at.length < Math.min(3, readable.length) || at.length === 0) break;
    curve.push({
      minute,
      observedPct: Math.round(percentile(at, 0.5) * 100),
      modeledPct: Math.round(Math.min(1, modeledCum) * 100),
    });
  }

  const impliedRatios = readable
    .filter((m) => m.impliedGrams != null && m.grams > 0)
    .map((m) => (m.impliedGrams! / m.grams) * 100);
  const impliedVsLoggedPct =
    impliedRatios.length > 0 ? Math.round(percentile(impliedRatios, 0.5)) : null;

  let verdict: PresetVerdict = 'building';
  let note = `${readable.length} of ${MIN_MEALS_PER_PRESET} cleanly-read meals needed before this preset's shape can be stated. Meals overlapping other meals are set aside on purpose.`;

  // Marked entries are graded against their own curve; say so in the notes
  // instead of implying the plain preset shape.
  const curveName = modelKind === 'piecewise' ? `${presetHours}h preset` : modelKindLabel(modelKind);

  if (readable.length >= MIN_MEALS_PER_PRESET && medianMinutesTo90 != null) {
    const label = formatMinutes(medianMinutesTo90);
    if (stillGoingSharePct >= 50 || medianMinutesTo90 >= presetMinutes * 1.05) {
      verdict = 'outlasts';
      note =
        stillGoingSharePct >= 50
          ? `${stillGoingSharePct}% of these meals were still showing impact when the observation window closed — plates entered at ${presetHours}h have been running past the ${curveName}. Entries like these have tracked a longer absorption than the ${curveName} models.`
          : `Impact typically took ${label} to finish against the ${presetHours}h the ${curveName} models — entries like these have tracked a longer absorption than the ${curveName}.`;
    } else if (medianMinutesTo90 <= modeledMinutesTo90 * 0.78) {
      verdict = 'finishes_early';
      note = `About 90% of the impact typically arrived by ${label}, where the ${curveName} models ${formatMinutes(modeledMinutesTo90)} — plates entered at ${presetHours}h have tracked a shorter absorption than the ${curveName}.`;
    } else {
      verdict = 'matches';
      note = `Observed timing sits close to what the ${curveName} models — peak inside the modelled window and ~90% done by ${label}. The ${curveName} fits these plates.`;
    }
  }

  return {
    presetHours,
    presetMinutes,
    modelKind,
    modelLabel: modelKindLabel(modelKind),
    mealCount: readable.length,
    loggedCount,
    medianMinutesToPeak,
    medianMinutesTo50,
    medianMinutesTo90,
    stillGoingSharePct,
    modeledPeakStart,
    modeledPeakEnd,
    modeledMinutesTo90,
    curve,
    verdict,
    note,
    impliedVsLoggedPct,
  };
}

export function computeAbsorptionInsights(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  windowDays: number;
  now: Date;
}): AbsorptionInsights {
  const startMs = input.now.getTime() - input.windowDays * 24 * 3600_000;
  const since = <T extends { iso: string }>(xs: T[]) => xs.filter((x) => ms(x.iso) >= startMs);
  const carbs = since(input.carbs);

  const { observed, excludedOverlapping, excludedOther } = observeMeals({
    glucose: since(input.glucose),
    carbs,
    insulin: input.insulin,
    therapy: input.therapy,
  });

  // Presets discovered from the sittings themselves — the user's own 3h/4h/6h
  // (or whatever they actually use) emerge rather than being hardcoded. A
  // combined sitting buckets under its grams-weighted absorption, snapped to
  // the nearest half hour. Marked entries (🥜/🍲) are individual cases: they
  // group by duration AND curve, so a hand-dialled 12h plate never shares a
  // card — or a verdict — with a 🥜 dessert entry.
  const presetOf = (h: number) => Math.round(h * 2) / 2;
  const sittings = combineCarbEntries(carbs).filter((m) => m.grams >= MIN_GRAMS);
  const loggedByPreset = new Map<string, { hours: number; kind: AbsorptionModelKind; count: number }>();
  for (const m of sittings) {
    const hours = presetOf(m.absorptionHours);
    const kind = modelKindForEntry(m);
    const key = `${hours}|${kind}`;
    const bucket = loggedByPreset.get(key) ?? { hours, kind, count: 0 };
    bucket.count += 1;
    loggedByPreset.set(key, bucket);
  }

  const kindOrder: Record<AbsorptionModelKind, number> = { piecewise: 0, heavy: 1, dessert: 2, delayedMetabolicV1: 3 };
  const presets: PresetGroup[] = [...loggedByPreset.values()]
    .filter(({ count }) => count >= MIN_LOGGED_PER_PRESET)
    .sort((a, b) => a.hours - b.hours || kindOrder[a.kind] - kindOrder[b.kind])
    .map(({ hours, kind, count }) =>
      buildPresetGroup(
        hours,
        kind,
        observed.filter((m) => presetOf(m.presetHours) === hours && m.modelKind === kind),
        count,
      ),
    );

  // Foods, by label. "Which preset does this plate actually behave like" is
  // the question that lets a curve finding become a different entry next time.
  const byLabel = new Map<string, ObservedMeal[]>();
  for (const m of observed) {
    const label = m.label?.trim();
    if (!label || m.minutesToPeak == null) continue;
    const key = label.toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(m);
  }

  // "Tracks preset" only ever points at plain presets: a 🥜/🍲-marked entry is
  // already an explicit curve choice, not a duration to be recommended.
  const presetT90s = presets
    .filter((p) => p.modelKind === 'piecewise')
    .map((p) => ({
      hours: p.presetHours,
      t90: p.modeledMinutesTo90,
    }));

  const foods: FoodGroup[] = [...byLabel.values()]
    .filter((meals) => meals.length >= MIN_MEALS_PER_FOOD)
    .map((meals) => {
      const label = meals[0].label!.trim();
      const t90 = median(meals.map((m) => m.minutesTo90 ?? m.observedMinutes));
      const peak = median(meals.map((m) => m.minutesToPeak));
      const loggedPreset = mostCommon(meals.map((m) => presetOf(m.presetHours)));

      let closest: number | null = null;
      if (t90 != null && presetT90s.length > 0) {
        closest = presetT90s.reduce((best, p) =>
          Math.abs(p.t90 - t90) < Math.abs(best.t90 - t90) ? p : best,
        ).hours;
      }

      const stillGoing = meals.filter((m) => m.minutesTo90 == null).length;
      let note: string;
      if (closest != null && closest !== loggedPreset) {
        note = `Usually entered at ${loggedPreset}h, but the observed done-time (${t90 != null ? formatMinutes(t90) : '—'}) tracks your ${closest}h preset more closely across ${meals.length} meals.`;
      } else if (stillGoing > meals.length / 2) {
        note = `Impact regularly outlasted the observation window — this plate runs longer than its entries model.`;
      } else {
        note = `Behaves like its ${loggedPreset}h entries across ${meals.length} meals.`;
      }

      return {
        label,
        mealCount: meals.length,
        medianGrams: median(meals.map((m) => m.grams)) ?? 0,
        loggedPresetHours: loggedPreset,
        medianMinutesToPeak: peak,
        medianMinutesTo90: t90,
        closestPresetHours: closest,
        note,
      };
    })
    .sort((a, b) => b.mealCount - a.mealCount);

  const totalMeals = sittings.length;
  const cleanMeals = observed.filter((m) => m.minutesToPeak != null).length;
  const comboMeals = observed.filter((m) => m.entryCount > 1).length;

  const dataNote =
    totalMeals === 0
      ? 'No meals in this window yet — absorption timing needs logged carb entries with glucose history around them.'
      : `${cleanMeals} of ${totalMeals} sittings could be read on a curve of their own${
          comboMeals > 0
            ? `, ${comboMeals} of them combined from entries within two hours of each other and read as one big meal`
            : ''
        }. ${excludedOverlapping} overlapped a separate meal's absorption and were set aside — a trace shared by two plates cannot be attributed to either. ${excludedOther > 0 ? `${excludedOther} more lacked the CGM coverage or rise to read.` : ''}`.trim();

  const insights: Omit<AbsorptionInsights, 'report'> = {
    windowDays: input.windowDays,
    totalMeals,
    cleanMeals,
    comboMeals,
    excludedOverlapping,
    excludedOther,
    presets,
    foods,
    dataNote,
  };

  return { ...insights, report: buildAbsorptionReport(insights, input.therapy) };
}

function mostCommon(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem === 0 ? `${h}h` : `${h}h ${rem.toString().padStart(2, '0')}m`;
}

/**
 * The paste-into-Claude export: everything the analysis measured, with the
 * context an outside model needs to reason about it, as plain markdown.
 */
export function buildAbsorptionReport(
  x: Omit<AbsorptionInsights, 'report'>,
  therapy: LoopTherapy,
): string {
  const lines: string[] = [];
  lines.push('# LoopStack — observed carb absorption export');
  lines.push('');
  lines.push(
    `Window: last ${x.windowDays} days. ${x.cleanMeals} of ${x.totalMeals} sittings readable in isolation${x.comboMeals > 0 ? `; ${x.comboMeals} were combined from carb entries within 2 h of each other and analysed as one meal` : ''} (${x.excludedOverlapping} excluded for overlapping a separate meal, ${x.excludedOther} for thin data).`,
  );
  lines.push(
    `Method: per-meal glucose deviations with modelled insulin activity netted out; positive deviations treated as carb impact. All figures are medians across meals. "Done" = 90% of observed impact arrived. Comparison model: Loop's piecewise-linear absorption (ramp to 15% of duration, plateau to 50%, decay to end) — except entries whose food label carries a fork curve marker (🥜12h second-wave dessert — legacy 🌙12h still counts — or 🍲8h long-tail heavy), which are graded against their own knee curve and listed as separate rows.`,
  );
  const isf = flatIsf(therapy);
  const cr = flatCarbRatio(therapy);
  lines.push(
    `Settings in force: ISF ~${isf} mg/dL/U, carb ratio ~${cr} g/U, carb sensitivity ~${seedCsf(isf, cr).toFixed(2)} mg/dL per gram, insulin duration ${therapy.insulinDurationHours}h.`,
  );
  lines.push('');
  lines.push('## By absorption preset');
  lines.push('');
  lines.push(
    '| Preset | Meals read / logged | Peak (obs) | Modelled peak window | 50% done | 90% done (obs) | 90% done (model) | Still going at window end | Implied vs logged grams | Read |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of x.presets) {
    const presetLabel =
      p.modelKind === 'piecewise' ? `${p.presetHours}h` : `${p.presetHours}h · ${p.modelLabel}`;
    lines.push(
      `| ${presetLabel} | ${p.mealCount} / ${p.loggedCount} | ${fmtOrDash(p.medianMinutesToPeak)} | ${formatMinutes(p.modeledPeakStart)}–${formatMinutes(p.modeledPeakEnd)} | ${fmtOrDash(p.medianMinutesTo50)} | ${fmtOrDash(p.medianMinutesTo90)} | ${formatMinutes(p.modeledMinutesTo90)} | ${p.stillGoingSharePct}% | ${p.impliedVsLoggedPct != null ? `${p.impliedVsLoggedPct}%` : '—'} | ${p.verdict.replace('_', ' ')} |`,
    );
  }
  lines.push('');
  for (const p of x.presets) {
    const presetLabel =
      p.modelKind === 'piecewise' ? `${p.presetHours}h` : `${p.presetHours}h · ${p.modelLabel}`;
    lines.push(`- **${presetLabel}:** ${p.note}`);
  }

  if (x.foods.length > 0) {
    lines.push('');
    lines.push('## By food');
    lines.push('');
    lines.push('| Food | Meals | Median grams | Entered as | Peak (obs) | 90% done (obs) | Tracks preset |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const f of x.foods) {
      lines.push(
        `| ${f.label} | ${f.mealCount} | ${f.medianGrams} g | ${f.loggedPresetHours}h | ${fmtOrDash(f.medianMinutesToPeak)} | ${fmtOrDash(f.medianMinutesTo90)} | ${f.closestPresetHours != null ? `${f.closestPresetHours}h` : '—'} |`,
      );
    }
  }

  lines.push('');
  lines.push(
    '_Caveats: implied grams inherit any ISF/carb-ratio error; unlogged meals and insulin-model error add noise that medians only partly remove; truncated windows make "done" times a floor. Absorption presets are carb-entry settings chosen in Loop — this export describes how plates behaved, and any change to entries or settings belongs with the person and their care team._',
  );

  return lines.join('\n');
}

function fmtOrDash(m: number | null): string {
  return m != null ? formatMinutes(m) : '—';
}
