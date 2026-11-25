import type { CurrentGlucose } from '@/lib/glucoseStatus';
import { sampleMetrics } from '@/data/metrics';
import type { ActivitySummary } from '@/lib/activity/activityEvents';
import type { LoopModeSummary } from '@/lib/loop/loopMode';
import { computeBasalInsights } from '@/lib/metabolism/basalInsights';
import { computeAutosens } from '@/lib/metabolism/autosens';
import { computeAutotune } from '@/lib/metabolism/autotune';
import { computeAbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import { computeSettingsReview } from '@/lib/metabolism/settingsReview';
import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import { computeWeekdayHourly } from '@/lib/metrics/weekdayHourly';
import { computeWeekdayExercise, type WeekdayExercise } from '@/lib/metrics/weekdayExercise';
import { computeRiskWindows } from '@/lib/alerts/riskWindows';
import { computeClinicianMetrics } from '@/lib/metrics/clinicianMetrics';
import { loadTargetRange } from '@/data/loopTherapyStore';
import { activityFraction, modelFromTherapy } from '@/lib/metabolism/insulinActivity';
import { computeTimeTrends } from '@/lib/metrics/timeTrends';
import { bucketInsulinByHour, type InsulinLedger } from '@/lib/metabolism/insulinLedger';
import { dailyBasalTotal, valueAt } from '@/data/loopTherapy';
import { activeLoopTherapy } from '@/data/loopTherapySchedules';
import {
  emptyResult,
  freshResult,
  type CarbEntry,
  type DataSnapshot,
  type DataSource,
  type DataSubscriber,
  type GlucoseReading,
  type HeartRateSample,
  type InsulinEvent,
  type WorkoutEntry,
} from './types';

const sampleCurrentGlucose: CurrentGlucose = {
  mgdl: 142,
  ratePer5min: 4.2,
  ratePer20min: 14,
  lastUpdatedIso: new Date(Date.now() - 2 * 60_000).toISOString(),
};

// Hand-authored activity summary: one workout + one HR window + one step
// burst with plausible glucose responses, so the Trends activity tile has a
// demo shape. Origin 'sample' keeps it visibly disclosed.
// Sample loop-mode summary: mostly-closed loop with a recurring evening
// manual window and one override that's underperforming — exercises every
// state of the Trends card.
const sampleLoopMode: LoopModeSummary = {
  windowDays: 14,
  closedLoopPct: 91,
  manualMinutesPerDay: 78,
  manualEpisodeCount: 6,
  longestManualMinutes: 140,
  peakManualHour: 18,
  overrideOutcomes: [
    {
      name: 'Workout',
      count: 8,
      totalMinutes: 640,
      avgGlucose: 148,
      tirPct: 79,
      baselineTirPct: 74,
      deltaTir: 5,
      verdict: 'working',
      note: 'Time in range ran 5% higher than baseline across 8 uses — this override is earning its keep.',
    },
    {
      name: 'Eating out',
      count: 4,
      totalMinutes: 480,
      avgGlucose: 186,
      tirPct: 58,
      baselineTirPct: 74,
      deltaTir: -16,
      verdict: 'review',
      note: 'Time in range ran 16% lower than baseline across 4 uses — the target or duration may not fit; worth reviewing with your care team.',
    },
  ],
  suggestions: [
    'Manual stretches cluster around 18:00–19:00 (6 episodes). A dedicated override preset for that window could cover the same need without leaving closed loop.',
    '"Eating out" override: Time in range ran 16% lower than baseline across 4 uses — the target or duration may not fit; worth reviewing with your care team.',
  ],
};

// Sample time-trends: synthesized from a plausible 6-week series with a
// weekend dip and a dinner-hour spike, then run through the real aggregator so
// the shape is internally consistent (not hand-typed percentages that don't add
// up). Origin stays 'sample' — this is demo data, disclosed as such.
const sampleTimeTrends = (() => {
  const readings: GlucoseReading[] = [];
  const start = new Date();
  start.setDate(start.getDate() - 42);
  // Deterministic pseudo-noise so the sample never changes shape between loads.
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 130;
  };
  for (let d = 0; d < 42; d++) {
    const day = new Date(start.getTime() + d * 24 * 3600_000);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < 4; q++) {
        const t = new Date(day);
        t.setHours(h, q * 15, 0, 0);
        // Dawn rise, lunch and dinner climbs, weekend elevation. The spread is wide enough that
        // days average near the sample's 74% in range (65–84% a day), so the day rings agree
        // with the headline instead of every day reading 99–100% (UX sweep, Nov 23).
        let base = 120;
        if (h >= 4 && h < 8) base += 25;
        if (h >= 12 && h < 15) base += 50;
        if (h >= 18 && h < 22) base += 80;
        if (h >= 0 && h < 3) base -= 10;
        if (weekend) base += 14;
        readings.push({ iso: t.toISOString(), mgdl: Math.round(base + noise()) });
      }
    }
  }
  return computeTimeTrends(readings, { lowMgdl: 70, highMgdl: 180 });
})();

// Sample insulin ledger: a plausible day of Loop's micro-dosing — a temp basal
// every 30 min plus boluses at the three meals — bucketed by the real hourly
// aggregator so the shape is internally consistent.
const sampleInsulinLedger: InsulinLedger = (() => {
  const now = new Date();
  const events: import('./types').InsulinEvent[] = [];
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const upto = now.getHours();
  for (let h = 0; h <= upto; h++) {
    // Two small temp basals an hour, roughly tracking the real schedule shape.
    const rate = h < 6 ? 0.32 : h < 11 ? 0.26 : h < 17 ? 0.22 : 0.3;
    for (const m of [5, 35]) {
      const t = new Date(midnight);
      t.setHours(h, m, 0, 0);
      if (t <= now) events.push({ iso: t.toISOString(), units: +rate.toFixed(2), kind: 'basal_temp' });
    }
  }
  const bolus = (h: number, u: number) => {
    const t = new Date(midnight);
    t.setHours(h, 15, 0, 0);
    if (t <= now) events.push({ iso: t.toISOString(), units: u, kind: 'bolus' });
  };
  bolus(8, 2.1); // oat bowl
  bolus(13, 2.2); // chickpea bowl
  bolus(19, 3.4); // dinner
  return {
    hourly: bucketInsulinByHour(events, now),
    hasBasal: true,
    scheduledBasalU: dailyBasalTotal(activeLoopTherapy()),
  };
})();

// Sample basal insight: quiet overnight stretches with a mild dawn rise, run
// through the real engine so the blocks and gates are internally consistent.
const sampleBasalInsights = (() => {
  const glucose: GlucoseReading[] = [];
  const now = new Date();
  for (let d = 1; d <= 8; d++) {
    const night = new Date(now.getTime() - d * 24 * 3600_000);
    night.setHours(0, 0, 0, 0);
    // Flat until ~3am, then a gentle rise to 6am — the classic dawn shape.
    for (let i = 0; i <= 60; i++) {
      const t = new Date(night.getTime() + i * 5 * 60_000);
      const hour = t.getHours() + t.getMinutes() / 60;
      const rise = hour > 3 ? (hour - 3) * 8 : 0;
      glucose.push({ iso: t.toISOString(), mgdl: Math.round(106 + rise) });
    }
  }
  return computeBasalInsights({
    glucose,
    carbs: [],
    insulin: [],
    therapy: activeLoopTherapy(),
    windowDays: 14,
    deliveredDailyU: 16.4,
    now,
  });
})();

// Sample history for the tuning and absorption engines: one continuous three
// weeks of CGM at five-minute cadence, three labelled meals a day, boluses
// cancelled analytically against the same insulin curve and scheduled ISF the
// engines net out — so every deviation the engines read is a shape this
// generator deliberately placed:
//   - a dawn rise left uncancelled (03:00–07:00), for the basal/tuning cards
//   - 3h entries that fit their preset, 4h entries that finish early, and a
//     slow 6h dinner (split dose) that outlasts its preset
//
// One continuous timeline rather than per-day resets: the dinner's tail
// crosses midnight, and a generator that starts each day fresh would drop the
// after-midnight impact while the engines still net the late dose there —
// filling the dinner's window with phantom positives.
//
// Run through the real engines, never hand-written: sample numbers the maths
// could not produce would misrepresent the feature. Everything is tagged
// 'sample' and carries a SampleTag on screen.
const sampleLongHistory = (() => {
  const glucose: GlucoseReading[] = [];
  const carbs: CarbEntry[] = [];
  const insulin: InsulinEvent[] = [];
  const therapy = activeLoopTherapy();
  const model = modelFromTherapy(therapy);
  // Cancel insulin at the SCHEDULED ISF for each minute of day — the engines
  // net at the schedule, and a flat stand-in leaves an insulin-shaped residual
  // in the deviations that reads as phantom carbs.
  const isfAt = (t: number) => {
    const d = new Date(t);
    return valueAt(therapy.insulinSensitivitySchedule, d.getHours() * 60 + d.getMinutes());
  };
  const CSF = 1.58; // ~ISF / carb ratio — so implied grams track logged grams
  const now = new Date();
  const DAYS = 28;

  // peak/done minutes define a triangular impact profile per plate. The slow
  // dinner takes its dose as a split — all up front, the insulin would outrun
  // the food so far that the synthetic glucose would hit the clamp, and a
  // clamped trace breaks the exact cancellation this generator depends on.
  const MENU = [
    { hour: 8, grams: 55, preset: 3, label: 'Oats + berries', peak: 45, done: 165, split: null as null | { upfront: number; laterAtMin: number } },
    { hour: 13, grams: 70, preset: 4, label: 'Burrito bowl', peak: 45, done: 150, split: null },
    { hour: 19, grams: 90, preset: 6, label: 'Pizza night', peak: 120, done: 560, split: { upfront: 0.45, laterAtMin: 120 } },
  ];

  const allMeals: { ms: number; grams: number; preset: number; label: string; peak: number; done: number; split: null | { upfront: number; laterAtMin: number } }[] = [];
  const doses: { atMs: number; units: number }[] = [];

  // Down to and including today (d = 0), so the sample carries meals that are
  // still absorbing right now. Stopping at yesterday left the app with no
  // carbs on board and a nine-hour-old newest reading — which made the
  // data-health alert fire against a source that was working fine.
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 24 * 3600_000);
    day.setHours(0, 0, 0, 0);
    // Rotate dinner between two labels so the food table has depth.
    const dinnerLabel = d % 2 === 0 ? 'Pizza night' : 'Dal + rice';
    for (const m of MENU) {
      // Today's later meals have not been eaten yet.
      if (day.getTime() + m.hour * 3600_000 > now.getTime()) continue;
      allMeals.push({
        ms: day.getTime() + m.hour * 3600_000,
        grams: m.grams,
        preset: m.preset,
        label: m.hour === 19 ? dinnerLabel : m.label,
        peak: m.peak,
        done: m.done,
        split: m.split,
      });
    }
    // Every third day, dessert lands 90 minutes after dinner — inside the
    // two-hour combining rule, so the engines read dinner + dessert as one
    // sitting. This is the combo path the meal surfaces demonstrate.
    if (d % 3 === 0 && day.getTime() + 20.5 * 3600_000 <= now.getTime()) {
      allMeals.push({
        ms: day.getTime() + 20.5 * 3600_000,
        grams: 25,
        preset: 6,
        label: 'Fruit crumble',
        peak: 40,
        done: 150,
        split: null,
      });
    }
  }

  for (const m of allMeals) {
    carbs.push({
      iso: new Date(m.ms).toISOString(),
      grams: m.grams,
      absorptionHours: m.preset,
      label: m.label,
    });
    const totalUnits = (m.grams * CSF) / 44;
    const parts = m.split
      ? [
          { atMs: m.ms - 15 * 60_000, units: totalUnits * m.split.upfront },
          { atMs: m.ms + m.split.laterAtMin * 60_000, units: totalUnits * (1 - m.split.upfront) },
        ]
      : [{ atMs: m.ms - 15 * 60_000, units: totalUnits }];
    for (const part of parts) {
      const units = +part.units.toFixed(2);
      insulin.push({ iso: new Date(part.atMs).toISOString(), units, kind: 'bolus' });
      doses.push({ atMs: part.atMs, units });
    }
  }

  const impactAt = (t: number): number => {
    let v = 0;
    for (const m of allMeals) {
      const since = (t - m.ms) / 60_000;
      if (since <= 0 || since >= m.done) continue;
      const height = (2 * m.grams * CSF) / m.done; // triangle area = grams×CSF
      v += height * (since < m.peak ? since / m.peak : (m.done - since) / (m.done - m.peak));
    }
    return v;
  };

  const firstDay = new Date(now.getTime() - DAYS * 24 * 3600_000);
  firstDay.setHours(0, 0, 0, 0);
  // Through to the present, so the newest reading is minutes old rather than
  // hours — freshness is itself a thing the app reports on.
  const totalSteps = Math.floor((now.getTime() - firstDay.getTime()) / (5 * 60_000));
  let mgdl = 112;
  for (let step = 0; step <= totalSteps; step++) {
    const t = firstDay.getTime() + step * 5 * 60_000;
    const hour = new Date(t).getHours();
    let delta = impactAt(t) * 5;
    for (const dose of doses) {
      const age = (t - dose.atMs) / 60_000;
      if (age <= 0 || age >= model.durationMinutes) continue;
      delta -= dose.units * activityFraction(age, model) * isfAt(t) * 5;
    }
    // The dawn rise, left uncancelled on purpose — the signal the basal and
    // tuning cards exist to show. Gentle enough to stay under the engines'
    // unannounced-meal threshold, so it lands in the basal bucket.
    if (hour >= 3 && hour < 7) delta += 0.55;
    // A recurring Friday-afternoon low: the pattern the risk-window engine and
    // its alerts exist to find. Confined to one weekday so the day-specific
    // path fires rather than the every-day one, and shaped as a contained dip
    // — descend, hold, recover — so the low sits in the afternoon instead of
    // dragging on into the evening and being detected there instead.
    const at = new Date(t);
    if (at.getDay() === 5) {
      const mins = at.getHours() * 60 + at.getMinutes();
      // Sized against the post-lunch baseline (~145), not against 112 — the
      // dip has to clear the whole lunch curve before it reaches a real low.
      if (mins >= 870 && mins < 930) delta -= 7.0;        // 14:30–15:30 descend
      else if (mins >= 930 && mins < 1020) delta -= 0.2;  // 15:30–17:00 hold
      else if (mins >= 1020 && mins < 1110) delta += 3.5; // 17:00–18:30 recover
    }
    // Faint pull to baseline keeps three weeks bounded without distorting any
    // single meal's shape.
    delta += (112 - mgdl) * 0.004;
    mgdl = Math.max(52, Math.min(290, mgdl + delta));
    glucose.push({ iso: new Date(t).toISOString(), mgdl: Math.round(mgdl * 10) / 10 });
  }

  // Temp basals at the scheduled rate: they net to zero in every deviation
  // engine (so nothing above shifts), while giving the max-basal review real
  // records to read — the sample then demonstrates "cap never approached"
  // instead of "needs Nightscout".
  for (let d = DAYS; d >= 1; d--) {
    const day = new Date(now.getTime() - d * 24 * 3600_000);
    day.setHours(0, 0, 0, 0);
    for (const h of [2, 6, 10, 15, 21]) {
      const t = day.getTime() + h * 3600_000;
      const rate = valueAt(therapy.basalSchedule, h * 60);
      insulin.push({
        iso: new Date(t).toISOString(),
        units: +(rate / 2).toFixed(3),
        kind: 'basal_temp',
        rateUPerHr: rate,
        durationMin: 30,
      });
    }
  }

  const autotune = computeAutotune({ glucose, carbs, insulin, therapy, windowDays: DAYS, now });
  const absorption = computeAbsorptionInsights({ glucose, carbs, insulin, therapy, windowDays: DAYS, now });
  return {
    // Exposed as the snapshot's recentGlucose: without it the mock reports no
    // readings at all, and anything checking data freshness — the data-health
    // alert above all — would fire "stream has gone quiet" against a source
    // that is working perfectly.
    glucose,
    carbs,
    insulin,
    autosens: computeAutosens({ glucose, carbs, insulin, therapy, now }),
    autotune,
    absorption,
    dayHourGrid: computeDayHourGrid({
      glucose,
      target: loadTargetRange(),
      now,
      carbs,
    }),
    weekdayHourly: computeWeekdayHourly({
      glucose,
      insulin,
      carbs,
      therapy,
      target: loadTargetRange(),
      now,
    }),
    riskWindows: computeRiskWindows({
      glucose,
      target: loadTargetRange(),
      now,
    }),
    // The clinic report's raw-history metrics, from the same four weeks. The
    // generator's temps run at the scheduled rate, so the sample honestly
    // shows no time at max basal and no zero temps.
    clinician: computeClinicianMetrics({
      glucose,
      carbs,
      insulin,
      therapy,
      target: loadTargetRange(),
      now,
      treatmentWindowDays: DAYS,
    }),
    settingsReview: computeSettingsReview({
      therapy,
      autotune,
      absorption,
      glucose,
      carbs,
      insulin,
      windowDays: DAYS,
      now,
    }),
  };
})();

// Four weeks of routine exercise for the weekday-hours exercise lane. The
// Friday lunchtime run sits just before the sample's recurring Friday-afternoon
// low, so the example shows what the lane is for: a routine low with a routine
// workout ahead of it on the same time axis. The glucose generator does not
// model exercise; the two are placed together, not simulated together.
const sampleWeekdayExercise = (() => {
  const now = new Date();
  const workouts: WorkoutEntry[] = [];
  const minutes: { iso: string; minutes: number }[] = [];
  const at = (day: Date, hour: number, minute: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  const addMinutes = (start: Date, length: number) => {
    // Split into the clock hours it spans, as Apple's hourly read does.
    for (let t = start.getTime(); t < start.getTime() + length * 60_000; ) {
      const hourStart = new Date(t);
      hourStart.setMinutes(0, 0, 0);
      const hourEnd = hourStart.getTime() + 3600_000;
      const end = Math.min(hourEnd, start.getTime() + length * 60_000);
      minutes.push({ iso: hourStart.toISOString(), minutes: Math.round((end - t) / 60_000) });
      t = end;
    }
  };
  for (let d = 28; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 24 * 3600_000);
    const wd = day.getDay();
    const plan: { start: Date; length: number; type: WorkoutEntry['type'] | null }[] = [];
    if (wd >= 1 && wd <= 5) plan.push({ start: at(day, 12, 30), length: 15, type: null }); // lunchtime walk
    if (wd === 5) plan.push({ start: at(day, 13, 15), length: 45, type: 'running' });
    if (wd === 2 || wd === 4) plan.push({ start: at(day, 6, 30), length: 30, type: 'strength' });
    if (wd === 6) plan.push({ start: at(day, 9, 0), length: 75, type: 'cycling' });
    for (const p of plan) {
      if (p.start.getTime() + p.length * 60_000 > now.getTime()) continue;
      addMinutes(p.start, p.length);
      if (p.type) {
        workouts.push({
          id: `sample-${p.type}-${p.start.toISOString()}`,
          type: p.type,
          startTime: p.start.toISOString(),
          endTime: new Date(p.start.getTime() + p.length * 60_000).toISOString(),
          durationMinutes: p.length,
        });
      }
    }
  }
  return computeWeekdayExercise({ exerciseByHour: minutes, workouts, now });
})();

const sampleActivitySummary: ActivitySummary = {
  events: [],
  compositeExerciseMinutes: 96,
  duplicateWorkoutsDropped: 0,
  workoutMinutes: 45,
  hrElevatedMinutes: 21,
  stepBurstMinutes: 30,
  avgDropMgdl: 28,
  avgMinutesToNadir: 95,
  respondedEventCount: 3,
  windowHours: 72,
};

// Mock source: returns the hand-authored sample data synchronously. Used as
// the default while real sources are being built, and as a fallback if the
// real source fails to authorize.

function buildSnapshot(): DataSnapshot {
  return {
    currentGlucose: freshResult(
      sampleCurrentGlucose,
      sampleCurrentGlucose.lastUpdatedIso,
    ),
    // Raw event streams aren't seeded yet — UI doesn't read them today, but
    // they exist on the contract so future sources can populate them and
    // future computed views (recent-glucose chart, insulin-on-board ribbon)
    // can swap mock → real without touching the surface.
    recentGlucose: freshResult(
      sampleLongHistory.glucose,
      sampleLongHistory.glucose.at(-1)?.iso ?? null,
      'sample',
    ),
    recentInsulin: freshResult(
      sampleLongHistory.insulin,
      sampleLongHistory.insulin.at(-1)?.iso ?? null,
      'sample',
    ),
    // A plausible residual IOB from earlier in the day.
    currentLoopIob: freshResult(0.6, new Date().toISOString(), 'sample'),
    // The same four weeks of entries the sample engines read, so the clinic
    // report's carb blocks and meal panels agree with each other.
    recentCarbs: freshResult(sampleLongHistory.carbs, new Date().toISOString(), 'sample'),
    recentWorkouts: emptyResult<WorkoutEntry[]>(),
    recentHeartRate: emptyResult<HeartRateSample[]>(),
    restingHeartRate: emptyResult<number>(),
    metrics: freshResult(sampleMetrics, new Date().toISOString(), 'sample'),
    timeTrends: freshResult(sampleTimeTrends, new Date().toISOString(), 'sample'),
    insulinLedger: freshResult(sampleInsulinLedger, new Date().toISOString(), 'sample'),
    activitySummary: freshResult(
      sampleActivitySummary,
      new Date().toISOString(),
      'sample',
    ),
    loopMode: freshResult(sampleLoopMode, new Date().toISOString(), 'sample'),
    basalInsights: freshResult(sampleBasalInsights, new Date().toISOString(), 'sample'),
    autosens: freshResult(sampleLongHistory.autosens, new Date().toISOString(), 'sample'),
    autotune: freshResult(sampleLongHistory.autotune, new Date().toISOString(), 'sample'),
    absorptionInsights: freshResult(sampleLongHistory.absorption, new Date().toISOString(), 'sample'),
    settingsReview: freshResult(sampleLongHistory.settingsReview, new Date().toISOString(), 'sample'),
    riskWindows: freshResult(sampleLongHistory.riskWindows, new Date().toISOString(), 'sample'),
    dayHourGrid: freshResult(sampleLongHistory.dayHourGrid, new Date().toISOString(), 'sample'),
    weekdayHourly: freshResult(sampleLongHistory.weekdayHourly, new Date().toISOString(), 'sample'),
    weekdayExercise: sampleWeekdayExercise
      ? freshResult(sampleWeekdayExercise, new Date().toISOString(), 'sample')
      : emptyResult<WeekdayExercise>(),
    hypoEvents: freshResult(sampleLongHistory.clinician.hypoEvents, new Date().toISOString(), 'sample'),
    agp: freshResult(sampleLongHistory.clinician.agp, new Date().toISOString(), 'sample'),
    mealPanels: freshResult(sampleLongHistory.clinician.mealPanels, new Date().toISOString(), 'sample'),
    correctionOutcomes: freshResult(sampleLongHistory.clinician.correctionOutcomes, new Date().toISOString(), 'sample'),
    tempBasalUse: sampleLongHistory.clinician.tempBasalUse
      ? freshResult(sampleLongHistory.clinician.tempBasalUse, new Date().toISOString(), 'sample')
      : emptyResult(),
  };
}

export function createMockDataSource(): DataSource {
  let snapshot = buildSnapshot();
  const listeners = new Set<DataSubscriber>();

  return {
    kind: 'mock',
    displayName: 'Mock data (sample profile)',
    getSnapshot: () => snapshot,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    refresh: async () => {
      // Mock refresh just rebuilds the snapshot so the lastUpdatedIso "moves"
      // when something else triggers it. No network, no async work.
      snapshot = buildSnapshot();
      for (const cb of listeners) cb();
    },
  };
}
