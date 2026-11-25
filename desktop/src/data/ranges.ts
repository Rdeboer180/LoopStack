// Your glucose bands: urgent low, low and the in-range band, set under
// Settings → Your ranges, exactly as the phone's Profile → Targets sets them
// (the same fields, limits, validation and storage key, loopTherapyStore.ts).
// The dashboard scores against these. The care-team review and the standard
// five-band report keep the consensus bands (54 / 70–180 / 250), because a
// clinic compares them against Clarity and every other report it prints.
// Observations only (SAFE-1).
import {
  DEFAULT_TARGET_RANGE,
  loadTargetRange,
  loadTherapyOverrides,
  saveTherapyOverrides,
  clearTherapyOverrides,
  toEditable,
  validateTherapy,
  type EditableTherapy,
  type TherapyField,
} from '@/data/loopTherapyStore';
import { sampleUserProfile } from '@/data/userProfile';

export interface Bands {
  /** Below this is urgent low. */
  urgentLow: number;
  /** In range starts here; from urgentLow up to here is low. */
  low: number;
  /** In range ends here. */
  high: number;
}

/** The consensus bands every clinic report uses. Very high starts over 250 on both. */
export const STANDARD: Bands = { urgentLow: 54, low: 70, high: 180 };
export const VERY_HIGH = 250;

const fromStore = (): Bands => {
  const t = loadTargetRange();
  return { urgentLow: t.urgentLowMgdl ?? DEFAULT_TARGET_RANGE.urgentLowMgdl ?? 60, low: t.lowMgdl, high: t.highMgdl };
};

/** The bands in force for this session. Changing them reloads the data (Settings does it). */
export let BANDS: Bands = fromStore();
export const reloadBands = () => { BANDS = fromStore(); return BANDS; };

export const isStandard = (b: Bands = BANDS) => b.urgentLow === STANDARD.urgentLow && b.low === STANDARD.low && b.high === STANDARD.high;

/** "65–180" */
export const rangeText = (b: Bands = BANDS) => `${b.low}–${b.high}`;

/** Where a reading falls, from urgent low to very high. */
export type BandKey = 'urgent' | 'low' | 'in' | 'high' | 'veryHigh';
export function bandOf(g: number, b: Bands = BANDS): BandKey {
  return g < b.urgentLow ? 'urgent' : g < b.low ? 'low' : g <= b.high ? 'in' : g <= VERY_HIGH ? 'high' : 'veryHigh';
}

export interface BandRead { urgentPct: number; lowPct: number; inRangePct: number; highPct: number; veryHighPct: number }
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Percent of readings in each band. In range is the remainder, so the five add to 100. */
export function bandRead(values: readonly number[], b: Bands = BANDS): BandRead {
  const n = values.length;
  if (!n) return { urgentPct: 0, lowPct: 0, inRangePct: 0, highPct: 0, veryHighPct: 0 };
  const c = { urgent: 0, low: 0, in: 0, high: 0, veryHigh: 0 };
  for (const v of values) c[bandOf(v, b)] += 1;
  const urgentPct = r1((c.urgent / n) * 100);
  const lowPct = r1((c.low / n) * 100);
  const highPct = r1((c.high / n) * 100);
  const veryHighPct = r1((c.veryHigh / n) * 100);
  return { urgentPct, lowPct, inRangePct: r1(100 - urgentPct - lowPct - highPct - veryHighPct), highPct, veryHighPct };
}

/** The editable record, as the phone keeps it: stored values, else the profile's own. */
export const editable = (): EditableTherapy => loadTherapyOverrides() ?? toEditable(sampleUserProfile.clinical);

export type BandField = Extract<TherapyField, 'urgentLowMgdl' | 'targetLowMgdl' | 'targetHighMgdl'>;

/** Check and save new bands with the phone's own rules; returns the first problem, or null when saved. */
export function saveBands(next: Bands): string | null {
  const rec: EditableTherapy = { ...editable(), urgentLowMgdl: next.urgentLow, targetLowMgdl: next.low, targetHighMgdl: next.high };
  for (const f of ['urgentLowMgdl', 'targetLowMgdl', 'targetHighMgdl'] as const) {
    const r = validateTherapy(rec, f);
    if (!r.ok) return r.message;
  }
  saveTherapyOverrides(rec);
  reloadBands();
  return null;
}

/** Back to the profile's bands. Other stored values (ratio, ISF, duration) go too, as on the phone. */
export function resetBands(): void {
  clearTherapyOverrides();
  reloadBands();
}

/**
 * How far a meal's lowest and highest went, from your bands: low side 1 below
 * your low, 2 below urgent low, 3 more than 5 under urgent low; high side 1
 * above your high, 2 over 20 above it, 3 over 40 above it.
 */
export type Tier = 0 | 1 | 2 | 3;
export const lowTierOf = (g: number, b: Bands = BANDS): Tier => (g < b.urgentLow - 5 ? 3 : g < b.urgentLow ? 2 : g < b.low ? 1 : 0);
export const highTierOf = (g: number, b: Bands = BANDS): Tier => (g > b.high + 40 ? 3 : g > b.high + 20 ? 2 : g > b.high ? 1 : 0);
