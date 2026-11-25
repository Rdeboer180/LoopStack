// Nightscout records → the phone app's Tuning engine → suggestions
// (PRODUCT.md SAFE-5a). Pure, so it's tested with fixtures. Values the
// Nightscout profile doesn't carry (safety limit, delivery limits, insulin
// duration, pre-meal range) come from the phone app's defaults; they never
// become suggestions, since safety limits are never suggested.
import { computeAutotune, type AutotuneResult } from '@/lib/metabolism/autotune';
import { computeAbsorptionInsights, type AbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import { absorptionPatternFromNotes } from '@/lib/metabolism/carbAbsorption';
import { dedupeCarbEntries, dedupeInsulinEvents } from '@/lib/metabolism/dedupe';
import { realLoopTherapy, type LoopTherapy, type ScheduleEntry } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { NsEntry, NsProfile, NsSchedule, NsStatus, NsTreatment } from './nightscout';
import { foodId, settingSuggestions, type Suggestion } from './suggestions';

const secOf = (s: NsSchedule) => s.timeAsSeconds ?? (s.time ? Number(s.time.slice(0, 2)) * 3600 + Number(s.time.slice(3, 5)) * 60 : 0);
const toSched = (xs: readonly NsSchedule[] | undefined, scale = 1): ScheduleEntry[] =>
  [...(xs ?? [])].sort((a, b) => secOf(a) - secOf(b)).map((s) => ({ startMinutes: Math.round(secOf(s) / 60), value: s.value * scale }));
const iso = (ms: number) => new Date(ms).toISOString();

/** The latest Nightscout profile as the engine's therapy, with the phone defaults for what Nightscout doesn't carry. */
export function therapyFrom(p: NsProfile | null, now: number): LoopTherapy {
  if (!p) return { ...realLoopTherapy, capturedIso: iso(now) };
  const k = /mmol/i.test(p.units) ? 18 : 1;
  const lows = toSched(p.targetLow, k);
  const highs = toSched(p.targetHigh, k);
  return {
    ...realLoopTherapy,
    basalSchedule: toSched(p.basal).length ? toSched(p.basal) : realLoopTherapy.basalSchedule,
    carbRatioSchedule: toSched(p.carbratio).length ? toSched(p.carbratio) : realLoopTherapy.carbRatioSchedule,
    insulinSensitivitySchedule: toSched(p.sens, k).length ? toSched(p.sens, k) : realLoopTherapy.insulinSensitivitySchedule,
    correctionRange: lows.length ? lows.map((l, i) => ({ startMinutes: l.startMinutes, low: Math.round(l.value), high: Math.round(highs[i]?.value ?? l.value) })) : realLoopTherapy.correctionRange,
    capturedIso: p.startDate,
  };
}

export interface EngineInputs { glucose: GlucoseReading[]; insulin: InsulinEvent[]; carbs: CarbEntry[]; loopIob: { iso: string; iob: number }[]; /** Loop's own carbs on board each cycle (devicestatus), oldest first. */ loopCob: { ms: number; cob: number }[] }

/** Nightscout records as the engine's input types. */
export function engineInputs(entries: readonly NsEntry[], treatments: readonly NsTreatment[], statuses: readonly NsStatus[]): EngineInputs {
  const glucose = entries.map((e) => ({ iso: iso(e.date), mgdl: e.sgv }));
  const insulin: InsulinEvent[] = [];
  const carbs: CarbEntry[] = [];
  for (const t of treatments) {
    const at = Date.parse(t.created_at);
    if (!Number.isFinite(at)) continue;
    if (typeof t.insulin === 'number' && t.insulin > 0) insulin.push({ iso: iso(at), units: t.insulin, kind: 'bolus' });
    const rate = t.rate ?? t.absolute;
    if (/temp basal/i.test(t.eventType ?? '') && typeof rate === 'number' && typeof t.duration === 'number' && t.duration > 0) {
      insulin.push({ iso: iso(at), units: (rate * t.duration) / 60, kind: 'basal_temp', durationMin: t.duration, rateUPerHr: rate });
    }
    if (typeof t.carbs === 'number' && t.carbs > 0) {
      carbs.push({ iso: iso(at), grams: t.carbs, absorptionHours: t.absorptionTime ? t.absorptionTime / 60 : 3, label: t.foodType ?? undefined, absorptionPattern: absorptionPatternFromNotes(t.notes) });
    }
  }
  const loopIob = statuses.filter((s) => typeof s.iob === 'number').map((s) => ({ iso: s.created_at, iob: s.iob! }));
  const loopCob = statuses
    .filter((s) => typeof s.cob === 'number' && Number.isFinite(s.cob) && !s.failed)
    .map((s) => ({ ms: Date.parse(s.loopAt ?? s.created_at), cob: s.cob! }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);
  return { glucose, insulin: dedupeInsulinEvents(insulin), carbs: dedupeCarbEntries(carbs), loopIob, loopCob };
}

/** Run the Tuning engine over the last three weeks. Null if the engine can't run. */
export function tuning(inputs: EngineInputs, therapy: LoopTherapy, now: number): AutotuneResult | null {
  try {
    return computeAutotune({ ...inputs, therapy, windowDays: 21, now: new Date(now) });
  } catch {
    return null;
  }
}

/**
 * Favorite foods, from the phone app's absorption engine: each food's observed
 * done-time (netted for insulin) against your own absorption presets. A food
 * becomes a suggestion only when it tracks a different preset than the one it's
 * entered with. Readable from 8 meals, caveated from 5.
 */
export function foodSuggestions(insights: AbsorptionInsights | null): Suggestion[] {
  if (!insights) return [];
  return insights.foods.filter((f) => f.closestPresetHours != null && f.closestPresetHours !== f.loggedPresetHours).map((f) => {
    const confidence = f.mealCount >= 8 ? 'good' : f.mealCount >= 5 ? 'limited' : 'unusable';
    return {
      id: foodId(f.label),
      kind: 'food' as const,
      target: 'absorption' as const,
      label: f.label,
      unit: 'min',
      current: Math.round(f.loggedPresetHours * 60),
      reading: confidence === 'unusable' ? null : Math.round(f.closestPresetHours! * 60),
      confidence,
      evidence: `${f.mealCount} meals · done-time ${f.medianMinutesTo90 == null ? '—' : `${f.medianMinutesTo90} min`} (to 90% absorbed)`,
      note: f.note,
      scope: f.label,
      grams: f.medianGrams,
    };
  });
}

/** Everything the Suggestions view lists for a Nightscout dataset. */
export function suggestionsFromNightscout(a: { entries: readonly NsEntry[]; treatments: readonly NsTreatment[]; statuses: readonly NsStatus[]; profile: NsProfile | null; now: number }): Suggestion[] {
  const inputs = engineInputs(a.entries, a.treatments, a.statuses);
  const therapy = therapyFrom(a.profile, a.now);
  const t = tuning(inputs, therapy, a.now);
  let foods: AbsorptionInsights | null = null;
  try { foods = computeAbsorptionInsights({ glucose: inputs.glucose, carbs: inputs.carbs, insulin: inputs.insulin, therapy, windowDays: 30, now: new Date(a.now) }); } catch { /* no food readings */ }
  return [...(t ? settingSuggestions(t) : []), ...foodSuggestions(foods)];
}
