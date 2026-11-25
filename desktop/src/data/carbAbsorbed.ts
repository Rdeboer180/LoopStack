// Observed carb absorption, ported line for line from Loop's dynamic carb
// model: LoopKit CarbMath.swift, `Collection.map(to:carbRatio:insulinSensitivity:…)`
// and `CarbStatusBuilder`, as built in Ryan's fork (nonlinear model, so the
// initial and maximum absorption times are both 1.5× the entered time, no
// adaptive rate, a 10-minute effect delay).
//
// How Loop counts it:
// - Each step of insulin counteraction (the glucose rise that insulin doesn't
//   explain; falls count as zero) is shared across the entries active at that
//   step, in proportion to each entry's modelled absorption *rate at that
//   moment*. That rate follows the entry's own curve: Loop's piecewise shape,
//   or the fork's 🥜 delayed-metabolic, dessert or heavy curve. So a 🥜 dessert
//   takes little of the early rise (dinner takes it) and more of the late one.
// - An entry is done when the counteraction credited to it reaches its grams.
//   Loop's minimum rate does NOT finish an entry early; it only bounds the
//   grams Loop assumes absorbed. An entry the counteraction never covers runs
//   to its maximum time, 1.5× entered plus the 10-minute delay.
// - The time Loop shows is the observed span plus its estimated time left,
//   which for an entry whose window has passed is just the observed span.
//
// What the ledger shows (changed Nov 23, after a 350 g sweet potato read 3h 38m
// here and 10h 27m in Loop):
// - "Absorbed in" is Loop's own count, below, so it matches the Loop app's carb
//   screen. That is how long Loop kept crediting the entry's grams.
// - "Rise landed in" is a separate figure: the phone app's done-time, when 90%
//   of the sitting's glucose rise had landed (entries within two hours are one
//   sitting, mealCombining.ts; counted from each entry). A slow meal can land its
//   rise in 3-4 hours while Loop keeps absorbing for 10, so the two are never
//   shown under one name.
//
// The counteraction steps come from the phone app's deviation engine, which
// nets every bolus and temp basal against the schedule. Pure, so it's tested.
import { computeDeviations, flatCarbRatio, flatIsf } from '@/lib/metabolism/deviations';
import { modelCumulativeFraction, modelKindForEntry, modelPercentTimeAtFraction, MODEL_KNEES, type AbsorptionModelKind } from '@/lib/metabolism/carbAbsorption';
import { valueAt, type LoopTherapy } from '@/data/loopTherapy';
import { observeMeals } from '@/lib/metabolism/absorptionProfile';
import { combineCarbEntries } from '@/lib/metabolism/mealCombining';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

/** Loop's absorptionTimeOverrun: the maximum absorption time is 1.5× the entered time. */
export const OVERRUN = 1.5;
/** CarbMath.defaultEffectDelay: minimum absorption starts 10 minutes after the entry. */
export const DELAY_MIN = 10;
const STEP_MIN = 5;
const MIN = 60_000;
const EPS = 1.1920929e-7; // Float.ulpOfOne

export interface AbsorbEntry { at: number; grams: number; absorptionMin: number; /** The curve the fork applies to this entry; Loop's piecewise shape when absent. */ kind?: AbsorptionModelKind; /** mg/dL per gram at the entry's time (Loop takes ISF ÷ carb ratio in force when it was entered); defaults to the first step's. */ csf?: number }
/** Results are keyed by entry time and grams, so two entries logged in the same minute stay apart. */
export const absorbKey = (at: number, grams: number) => `${at}|${Math.round(grams * 10) / 10}`;
export interface AbsorbStep { ms: number; /** mg/dL over the 5-minute step that insulin doesn't explain */ deviation: number; /** mg/dL per gram */ csf: number }
export interface Absorbed {
  /** Minutes Loop shows for the entry's absorption; null while it is still absorbing at the end of the data. */
  observedMin: number | null;
  /** Grams Loop counts as absorbed by the end of the data (observed, never under its minimum). */
  absorbedG: number;
  /** True when glucose, not Loop's maximum time, set the reading. */
  byObserved: boolean;
  /** Always Loop's carb count now; kept for callers that read it. */
  source?: 'sitting' | 'loop';
  /** Minutes until 90% of the sitting's glucose rise had landed, from this entry (the phone app's done-time); null when it can't be read. Not an absorption time. */
  riseMin?: number | null;
}

/** `percentRateAtPercentTime` for each curve, as in CarbMath.swift and the fork's custom curves. */
function percentRate(kind: AbsorptionModelKind, t: number): number {
  if (kind === 'piecewise') {
    const rise = 0.15, fall = 0.5;
    const scale = 2 / (1 + fall - rise);
    if (t > 0 && t < rise) return (scale * t) / rise;
    if (t >= rise && t < fall) return scale;
    if (t >= fall && t < 1) return scale * ((1 - t) / (1 - fall));
    return 0;
  }
  if (t <= 0 || t >= 1) return 0;
  const knees = MODEL_KNEES[kind];
  for (let i = 1; i < knees.length; i += 1) {
    if (t < knees[i][0]) {
      const span = knees[i][0] - knees[i - 1][0];
      return span > 0 ? (knees[i][1] - knees[i - 1][1]) / span : 0;
    }
  }
  return 0;
}

class Builder {
  readonly kind: AbsorptionModelKind;
  readonly initialAbs: number; // ms
  readonly maxAbs: number; // ms
  readonly delay = DELAY_MIN * MIN;
  readonly maxEnd: number;
  readonly lastEffect: number;
  observedG = 0;
  completion: number | null = null;

  constructor(readonly e: AbsorbEntry, lastEffect: number, readonly csf: number) {
    this.kind = e.kind ?? 'piecewise';
    this.initialAbs = e.absorptionMin * OVERRUN * MIN;
    this.maxAbs = e.absorptionMin * OVERRUN * MIN;
    this.maxEnd = e.at + this.maxAbs + this.delay;
    this.lastEffect = Math.min(this.maxEnd, Math.max(lastEffect, e.at));
  }

  /** mg/dL still to observe before the entry is covered. */
  get remainingEffect() { return Math.max(this.e.grams - this.observedG, 0) * this.csf; }
  private get time() { return this.lastEffect - this.e.at - this.delay; }
  private get minPredictedG() { return this.e.grams * modelCumulativeFraction(this.kind, this.time / this.maxAbs); }
  get clampedG() { return Math.min(this.e.grams, Math.max(this.minPredictedG, this.observedG)); }
  private get observedSpan() { return (this.completion ?? this.lastEffect) - this.e.at; }
  private get timeToAbsorbObserved() {
    if (this.time <= 0) return 0;
    return Math.min(modelPercentTimeAtFraction(this.kind, this.clampedG / this.e.grams) * this.initialAbs, this.maxAbs);
  }
  get estimatedRemaining() {
    const time = this.time;
    if (time <= 0) return this.initialAbs;
    const notToExceed = Math.max(this.maxAbs - time, 0);
    if (notToExceed <= 0) return 0;
    return Math.min(this.initialAbs - this.timeToAbsorbObserved, notToExceed);
  }
  /** g/ms at `t` ms after the entry, on the entry's own curve over its dynamic absorption time. */
  rateAt(t: number) {
    const dyn = Math.min(this.observedSpan + this.estimatedRemaining, this.maxAbs);
    if (dyn <= 0) return 0;
    return (this.e.grams / dyn) * percentRate(this.kind, t / dyn);
  }
  add(mgdl: number, end: number) {
    this.observedG += mgdl / this.csf;
    if (this.completion == null && this.observedG + EPS >= this.e.grams) this.completion = end;
  }
  result(): Absorbed {
    const active = this.estimatedRemaining > 0;
    return {
      observedMin: active ? null : Math.round((this.observedSpan + this.estimatedRemaining) / MIN),
      absorbedG: Math.round(this.clampedG * 10) / 10,
      byObserved: this.completion != null,
      source: 'loop',
    };
  }
}

/**
 * Walk the counteraction steps in time order, sharing each across the entries
 * active then by their modelled rates, as Loop does. `end` is the last moment
 * of data. Pure.
 */
export function absorbEntries(entries: readonly AbsorbEntry[], steps: readonly AbsorbStep[], end: number): Map<string, Absorbed> {
  const es = [...entries].filter((e) => e.grams > 0 && e.absorptionMin > 0).sort((a, b) => a.at - b.at);
  if (!es.length) return new Map();
  const sorted = [...steps].sort((a, b) => a.ms - b.ms);
  const builders = es.map((e) => new Builder(e, end, e.csf ?? sorted.find((s) => s.ms >= e.at && s.csf > 0)?.csf ?? sorted.find((s) => s.csf > 0)?.csf ?? 1));
  for (const s of sorted) {
    const start = s.ms - STEP_MIN * MIN;
    if (s.ms > end) break;
    const active = builders.filter((b) => start < b.maxEnd && start >= b.e.at);
    if (!active.length) continue;
    // Loop ignores falls: they're most likely insulin working harder, not food.
    let effect = Math.max(0, s.deviation);
    let total = active.reduce((sum, b) => sum + b.rateAt(start - b.e.at), 0);
    active.forEach((b, i) => {
      const rate = b.rateAt(start - b.e.at);
      let part = 0;
      if (total > 0) {
        part = Math.min(b.remainingEffect, (rate / total) * effect);
        total -= rate;
        effect -= part;
      }
      b.add(part, s.ms);
      // Left-over counteraction with no entry to take it counts as overrun on the last one.
      if (effect > EPS && i === active.length - 1) b.add(effect, s.ms);
    });
  }
  return new Map(builders.map((b) => [absorbKey(b.e.at, b.e.grams), b.result()]));
}

/** The longest gap between two Loop cycles that still counts as one stretch of COB. */
const COB_GAP_MIN = 20;

/**
 * Loop's own absorption, from its carbs on board each cycle: every drop in COB (after any
 * entry logged in between is added) is grams Loop counted as absorbed. Returned as steps in
 * mg/dL at a carb sensitivity of 1 g, so absorbEntries shares them across the active entries
 * by Loop's rate rule. Only stretches with cycles no more than 20 minutes apart. Pure.
 */
export function stepsFromLoopCob(cob: readonly { ms: number; cob: number }[], entries: readonly { at: number; grams: number }[]): { steps: AbsorbStep[]; covered: [number, number][] } {
  const steps: AbsorbStep[] = [];
  const covered: [number, number][] = [];
  for (let i = 1; i < cob.length; i += 1) {
    const a = cob[i - 1], b = cob[i];
    if (b.ms - a.ms > COB_GAP_MIN * MIN || b.ms <= a.ms) continue;
    const added = entries.filter((e) => e.at > a.ms && e.at <= b.ms).reduce((t, e) => t + e.grams, 0);
    const absorbed = Math.max(0, a.cob + added - b.cob);
    steps.push({ ms: b.ms, deviation: absorbed, csf: 1 });
    const last = covered[covered.length - 1];
    if (last && a.ms <= last[1]) last[1] = b.ms; else covered.push([a.ms, b.ms]);
  }
  return { steps, covered };
}

/** Times Loop's COB reached zero after carrying carbs: every entry before then is fully absorbed. */
export function cobZeros(cob: readonly { ms: number; cob: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cob.length; i += 1) if (cob[i].cob <= 0.5 && cob[i - 1].cob > 0.5 && cob[i].ms - cob[i - 1].ms <= COB_GAP_MIN * MIN) out.push(cob[i].ms);
  return out;
}

/**
 * Loop's COB hitting zero is exact: the last entry to finish before it finished then, and none
 * finished later. Sharing COB drops across overlapping entries can't place that moment exactly
 * (the drops include Loop's minimum-rate floor), so each run of entries is pinned to it. Pure.
 */
export function anchorToCobZeros(out: Map<string, Absorbed>, entries: readonly { at: number; grams: number }[], zeros: readonly number[]): void {
  let from = -Infinity;
  for (const z of zeros) {
    const run = entries.filter((e) => e.at > from && e.at < z).map((e) => ({ e, key: absorbKey(e.at, e.grams) })).filter((x) => out.has(x.key));
    from = z;
    if (!run.length) continue;
    const doneAt = (x: { e: { at: number }; key: string }) => { const r = out.get(x.key)!; return r.observedMin == null ? Infinity : x.e.at + r.observedMin * MIN; };
    const last = run.reduce((a, b) => (doneAt(b) > doneAt(a) ? b : a));
    for (const x of run) {
      const r = out.get(x.key)!;
      const m = x === last ? Math.round((z - x.e.at) / MIN) : Math.min(r.observedMin ?? Infinity, Math.round((z - x.e.at) / MIN));
      out.set(x.key, { ...r, observedMin: m, byObserved: true });
    }
  }
}

/**
 * Observed absorption for every carb entry. Keyed by absorbKey(time, grams).
 * Where Loop uploaded its carbs on board (Nightscout devicestatus), its own COB drops drive
 * the count, so the result follows Loop's carb screen (a 350 g sweet potato: 10h 27m in Loop,
 * 12h 10m from the reconstruction, which runs about 15% short of Loop's counteraction).
 * Elsewhere it falls back to counteraction rebuilt from glucose, insulin and the therapy in force.
 */
export function observedAbsorption(input: { glucose: GlucoseReading[]; carbs: CarbEntry[]; insulin: InsulinEvent[]; therapy: LoopTherapy; end: number; loopCob?: readonly { ms: number; cob: number }[] }): Map<string, Absorbed> {
  let steps: AbsorbStep[] = [];
  try {
    const cr = flatCarbRatio(input.therapy);
    const fallbackIsf = flatIsf(input.therapy);
    steps = computeDeviations(input).steps.map((s) => ({ ms: s.ms, deviation: s.deviation, csf: cr > 0 ? (s.isf || fallbackIsf) / cr : 0 }));
  } catch { /* no counteraction: entries run to Loop's maximum time */ }
  // Where Loop uploaded its carbs on board, its own COB drops are the grams absorbed each cycle.
  let zeros: number[] = [];
  let fromLoop = false;
  if (input.loopCob && input.loopCob.length > 1) {
    const { steps: loopSteps, covered } = stepsFromLoopCob(input.loopCob, input.carbs.map((c) => ({ at: Date.parse(c.iso), grams: c.grams })));
    if (loopSteps.length) {
      const inCover = (ms: number) => covered.some(([a, b]) => ms > a && ms <= b);
      steps = [...steps.filter((s) => !inCover(s.ms)), ...loopSteps];
      zeros = cobZeros(input.loopCob);
      fromLoop = true;
    }
  }
  const entries = input.carbs.map((c) => {
    const at = Date.parse(c.iso);
    const d = new Date(at);
    const minute = d.getHours() * 60 + d.getMinutes();
    const isf = valueAt(input.therapy.insulinSensitivitySchedule, minute) || flatIsf(input.therapy);
    const cr = valueAt(input.therapy.carbRatioSchedule, minute) || flatCarbRatio(input.therapy);
    return { at, grams: c.grams, absorptionMin: Math.round((c.absorptionHours || 3) * 60), kind: modelKindForEntry(c), csf: cr > 0 && isf > 0 ? isf / cr : undefined };
  });
  // Loop's COB steps are already in grams: each entry reads them at 1 g per unit, and the
  // rebuilt steps outside Loop's coverage are converted to grams at their own sensitivity.
  if (fromLoop) {
    steps = steps.map((s) => (s.csf === 1 ? s : { ms: s.ms, deviation: s.csf > 0 ? s.deviation / s.csf : 0, csf: 1 }));
    for (const e of entries) e.csf = 1;
  }
  const out = absorbEntries(entries, steps, input.end);
  if (fromLoop) anchorToCobZeros(out, entries, zeros);
  // The phone's done-time, kept beside Loop's count as when the rise landed (never in its place).
  try {
    const read = new Map(observeMeals(input).observed.filter((m) => m.minutesTo90 != null).map((m) => [Date.parse(m.iso), m.minutesTo90!]));
    for (const sitting of combineCarbEntries(input.carbs)) {
      const t90 = read.get(sitting.timeMs);
      if (t90 == null) continue;
      for (const c of sitting.entries) {
        const at = Date.parse(c.iso);
        const key = absorbKey(at, c.grams);
        const prev = out.get(key);
        if (!prev) continue;
        out.set(key, { ...prev, riseMin: Math.max(STEP_MIN, Math.round(t90 - (at - sitting.timeMs) / MIN)) });
      }
    }
  } catch { /* phone engine couldn't read these: no rise time */ }
  return out;
}
