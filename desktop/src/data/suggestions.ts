// Suggestions: what LoopStack's own readings point at, for therapy settings and
// favorite foods (PRODUCT.md SAFE-5a). The values come from the measured
// engines (the phone app's Tuning engine, the meal ledger), never from a
// language model. A suggestion can go into the next build only when
// eligibleForBuild says so; the main process checks the same rule again.
import type { AutotuneResult, Confidence } from '@/lib/metabolism/autotune';

export type SuggestionKind = 'setting' | 'food';
/** Settings LoopStack never suggests a build value for (SAFE-5a). */
export const SAFETY_LIMITS = ['safetyLimit', 'maxBasal', 'maxBolus', 'guardrails'] as const;
export type SettingTarget = 'basal' | 'isf' | 'carbRatio' | 'absorption' | (typeof SAFETY_LIMITS)[number];

export interface Suggestion {
  /** Stable across loads, so tracking survives a refresh: "basal-07", "isf", "food-burrito-bowl". */
  id: string;
  kind: SuggestionKind;
  target: SettingTarget;
  /** "Basal rate, 7–8am", "Insulin sensitivity", "Burrito bowl". */
  label: string;
  unit: string;
  current: number;
  /** The damped reading. Null when nothing can be read yet. */
  reading: number | null;
  confidence: Confidence;
  /** One line naming the evidence: "14 days, 62 five-minute steps". */
  evidence: string;
  /** The longer explanation the engine gives. */
  note: string;
  /** For basal: the hour (0–23). For foods: the favorite's name. */
  scope?: number | string;
  /** Foods: the usual carbs, so a new favorite can be made from it. */
  grams?: number;
}

/** A favorite food's id, the same from the meal ledger and the absorption engine: "🌯 Burrito bowl" → "food-burrito-bowl". */
/** One id per food name. Long or non-Latin names get a short hash, so two foods never share a record and every id fits the shared format. */
export const foodId = (name: string) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug && slug.length <= 60) return `food-${slug}`;
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLowerCase()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  const tag = h.toString(36);
  return slug ? `food-${slug.slice(0, 52).replace(/-$/, '')}-${tag}` : `food-${tag}`;
};

/** The share the reading moves from the value on file, 0.12 = 12%. */
export const stepOf = (s: Pick<Suggestion, 'current' | 'reading'>) =>
  s.reading == null || s.current === 0 ? null : Math.abs(s.reading - s.current) / Math.abs(s.current);

export const MAX_STEP = 0.2;

export type Gate = { ok: true } | { ok: false; reason: string };

/** SAFE-5a, in one place: top confidence, a step of at most 20%, never a safety limit. */
export function eligibleForBuild(s: Pick<Suggestion, 'target' | 'confidence' | 'current' | 'reading'>): Gate {
  if ((SAFETY_LIMITS as readonly string[]).includes(s.target)) return { ok: false, reason: 'Safety limit: stays in Loop' };
  if (s.reading == null) return { ok: false, reason: 'Nothing to read yet' };
  if (!Number.isFinite(s.current) || !Number.isFinite(s.reading) || s.current <= 0 || s.reading <= 0) return { ok: false, reason: 'Invalid reading or value on file' };
  if (s.confidence !== 'good') return { ok: false, reason: s.confidence === 'limited' ? 'Needs Readable confidence' : 'Not enough data yet' };
  const step = stepOf(s);
  if (step == null) return { ok: false, reason: 'Nothing to read yet' };
  if (step > MAX_STEP + 1e-9) return { ok: false, reason: 'Over the 20% step' };
  if (step < 0.005) return { ok: false, reason: 'Reads the same as on file' };
  return { ok: true };
}

/** The phone app's words for the three grades. */
export const CONFIDENCE_LABEL: Record<Confidence, string> = { good: 'Readable', limited: 'Caveated', unusable: 'Not enough data' };

const hourLabel = (h: number) => {
  const f = (x: number) => `${x % 12 || 12}${x % 24 < 12 ? 'am' : 'pm'}`;
  return `${f(h)}–${f(h + 1)}`;
};

/** Pumps deliver basal in fixed steps; 0.05 U/h fits Omnipod and most others. Rounded toward the value on file, so the step never grows. */
export const BASAL_STEP = 0.05;
export function pumpStep(current: number, reading: number): number {
  const steps = Math.trunc(Math.round(((reading - current) / BASAL_STEP) * 1e6) / 1e6);
  const onGrid = Math.round(current / BASAL_STEP) * BASAL_STEP;
  // From the nearest grid rate to what's on file, move whole steps toward the reading.
  const base = Math.abs(onGrid - current) < 1e-9 ? current : onGrid;
  return Math.round((base + steps * BASAL_STEP) * 1000) / 1000;
}

/** Settings suggestions from an autotune run: one per readable basal hour that moves, plus ISF and carb ratio. */
export function settingSuggestions(t: AutotuneResult): Suggestion[] {
  const out: Suggestion[] = [];
  for (const h of t.basal.hours) {
    if (Math.abs(pumpStep(h.scheduledRate, h.dampedRate) - h.scheduledRate) < 0.001 && h.confidence !== 'unusable') continue; // no whole pump step away: not a suggestion
    out.push({
      id: `basal-${String(h.hour).padStart(2, '0')}`,
      kind: 'setting',
      target: 'basal',
      label: `Basal rate, ${hourLabel(h.hour)}`,
      unit: 'U/h',
      current: h.scheduledRate,
      reading: h.confidence === 'unusable' ? null : pumpStep(h.scheduledRate, h.dampedRate),
      confidence: h.confidence,
      evidence: `${h.stepCount} five-minute steps over ${t.daysWithData} days`,
      note: t.basal.note,
      scope: h.hour,
    });
  }
  out.push({
    id: 'isf', kind: 'setting', target: 'isf', label: 'Insulin sensitivity', unit: 'mg/dL per U',
    current: t.isf.current, reading: t.isf.damped == null ? null : Math.round(t.isf.damped), confidence: t.isf.confidence,
    evidence: `${t.daysWithData} days of readings`, note: t.isf.note,
  });
  out.push({
    id: 'carbRatio', kind: 'setting', target: 'carbRatio', label: 'Carb ratio', unit: 'g per U',
    current: t.carbRatio.current, reading: t.carbRatio.damped == null ? null : Math.round(t.carbRatio.damped * 2) / 2, confidence: t.carbRatio.confidence,
    evidence: `${t.carbRatio.mealCount} meals over ${t.daysWithData} days`, note: t.carbRatio.note,
  });
  return out;
}

/** "1:9", "0.85 U/h", "45 mg/dL per U", "3 h". */
export function fmtValue(s: Pick<Suggestion, 'target' | 'unit'>, v: number | null): string {
  if (v == null) return '—';
  if (s.target === 'carbRatio') return `1:${v}`;
  if (s.target === 'basal') return `${v.toFixed(2)} U/h`;
  if (s.target === 'absorption') return v >= 60 ? `${+(v / 60).toFixed(1)} h` : `${v} min`;
  return `${v} ${s.unit}`;
}

/** The reading in plain words: an observation, never an instruction (SAFE-1). */
export function readingLine(s: Suggestion): string {
  if (s.reading == null) return `Not enough data to read ${s.label.toLowerCase()} yet.`;
  const step = stepOf(s) ?? 0;
  return `On file ${fmtValue(s, s.current)}. Readings point to ${fmtValue(s, s.reading)} (${Math.round(step * 100)}% ${s.reading > s.current ? 'higher' : 'lower'}).`;
}
