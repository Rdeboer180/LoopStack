import type { LoopTherapy, RangeEntry, ScheduleEntry } from './loopTherapy';
import { realLoopTherapy } from './loopTherapy';

// Editable mirror of Loop's schedule-based therapy settings.
//
// These used to live only as hardcoded constants in loopTherapy.ts, with a
// comment telling you to re-transcribe by hand whenever Loop changed. That is
// the maintenance burden the screenshot pipeline was meant to remove; since
// that pipeline is gone, every Loop setting instead gets a place to be entered
// here, and what you enter is what the dose engine resolves against.
//
// LoopStack still never writes to Loop. This is its record of what Loop is
// running — nothing more, and stale values here quietly corrupt every estimate,
// which is why the UI shows when they were last confirmed.

const STORAGE_KEY = 'loopstack.loopSchedules.v1';

export type EditableSchedules = {
  glucoseSafetyLimitMgdl: number;
  preMealRange: { low: number; high: number };
  correctionRange: RangeEntry[];
  carbRatioSchedule: ScheduleEntry[];
  basalSchedule: ScheduleEntry[];
  insulinSensitivitySchedule: ScheduleEntry[];
  maxBasalRate: number;
  maxBolus: number;
  insulinDurationHours: number;
  /** When these were last confirmed against the Loop app. */
  capturedIso: string;
};

/** Which scalar fields exist, and the bounds a typed value must clear. */
export const scalarLimits = {
  glucoseSafetyLimitMgdl: { min: 60, max: 120, step: 1, unit: 'mg/dL', label: 'Glucose safety limit' },
  maxBasalRate: { min: 0, max: 15, step: 0.05, unit: 'U/hr', label: 'Max basal rate' },
  maxBolus: { min: 0, max: 30, step: 0.5, unit: 'U', label: 'Max bolus' },
  insulinDurationHours: { min: 2, max: 12, step: 0.5, unit: 'h', label: 'Insulin duration' },
} as const;

export type ScalarField = keyof typeof scalarLimits;

/** Per-schedule value bounds, so a mistyped basal can't reach the dose engine. */
export const scheduleLimits = {
  carbRatioSchedule: { min: 1, max: 60, step: 0.1, unit: 'g/U', label: 'Carb ratios' },
  basalSchedule: { min: 0, max: 5, step: 0.05, unit: 'U/hr', label: 'Basal rates' },
  insulinSensitivitySchedule: { min: 5, max: 300, step: 1, unit: 'mg/dL per U', label: 'Insulin sensitivities' },
} as const;

export type ScheduleField = keyof typeof scheduleLimits;

export const RANGE_LIMITS = { min: 60, max: 300, step: 1, unit: 'mg/dL' };

/** Defaults are the transcribed real settings — the mirror starts truthful. */
export function defaultSchedules(): EditableSchedules {
  const t = realLoopTherapy;
  return {
    glucoseSafetyLimitMgdl: t.glucoseSafetyLimitMgdl,
    preMealRange: { ...t.preMealRange },
    correctionRange: t.correctionRange.map((e) => ({ ...e })),
    carbRatioSchedule: t.carbRatioSchedule.map((e) => ({ ...e })),
    basalSchedule: t.basalSchedule.map((e) => ({ ...e })),
    insulinSensitivitySchedule: t.insulinSensitivitySchedule.map((e) => ({ ...e })),
    maxBasalRate: t.maxBasalRate,
    maxBolus: t.maxBolus,
    insulinDurationHours: t.insulinDurationHours,
    capturedIso: t.capturedIso,
  };
}

function isEntry(v: unknown): v is ScheduleEntry {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o.startMinutes === 'number' &&
    typeof o.value === 'number' &&
    Number.isFinite(o.startMinutes) &&
    Number.isFinite(o.value)
  );
}

function isRangeEntry(v: unknown): v is RangeEntry {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o.startMinutes === 'number' &&
    typeof o.low === 'number' &&
    typeof o.high === 'number'
  );
}

function isSchedulesShape(v: unknown): v is EditableSchedules {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object') return false;
  return (
    typeof o.glucoseSafetyLimitMgdl === 'number' &&
    Array.isArray(o.correctionRange) &&
    (o.correctionRange as unknown[]).every(isRangeEntry) &&
    Array.isArray(o.carbRatioSchedule) &&
    (o.carbRatioSchedule as unknown[]).every(isEntry) &&
    Array.isArray(o.basalSchedule) &&
    (o.basalSchedule as unknown[]).every(isEntry) &&
    Array.isArray(o.insulinSensitivitySchedule) &&
    (o.insulinSensitivitySchedule as unknown[]).every(isEntry)
  );
}

export function loadSchedules(): EditableSchedules {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSchedules();
    const parsed = JSON.parse(raw);
    return isSchedulesShape(parsed) ? parsed : defaultSchedules();
  } catch {
    return defaultSchedules();
  }
}

export function saveSchedules(next: EditableSchedules): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the edit still applies for this session.
  }
}

export function clearSchedules(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Sort by start time and drop duplicate starts — a schedule with two entries
 *  at the same minute has an ambiguous value at that moment. */
export function normalizeSchedule<T extends { startMinutes: number }>(entries: T[]): T[] {
  const byStart = new Map<number, T>();
  for (const e of entries) byStart.set(e.startMinutes, e);
  return [...byStart.values()].sort((a, b) => a.startMinutes - b.startMinutes);
}

/** "6:30 AM" from minutes-since-midnight. */
export function formatStart(startMinutes: number): string {
  const h24 = Math.floor(startMinutes / 60) % 24;
  const m = startMinutes % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Total daily basal — the number to check against Loop's own total. */
export function scheduleDailyTotal(entries: ScheduleEntry[]): number {
  const sorted = normalizeSchedule(entries);
  if (sorted.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].startMinutes;
    const end = i + 1 < sorted.length ? sorted[i + 1].startMinutes : 24 * 60;
    total += ((end - start) / 60) * sorted[i].value;
  }
  return Math.round(total * 100) / 100;
}

/**
 * The therapy Loop is running, as LoopStack currently has it: the stored
 * edits when present, the transcribed defaults otherwise.
 *
 * Every consumer that used to import `realLoopTherapy` directly should call
 * this instead, or a user's own edits silently never reach the dose engine.
 */
export function activeLoopTherapy(): LoopTherapy {
  const s = loadSchedules();
  return {
    glucoseSafetyLimitMgdl: s.glucoseSafetyLimitMgdl,
    correctionRange: normalizeSchedule(s.correctionRange),
    preMealRange: s.preMealRange,
    carbRatioSchedule: normalizeSchedule(s.carbRatioSchedule),
    basalSchedule: normalizeSchedule(s.basalSchedule),
    insulinSensitivitySchedule: normalizeSchedule(s.insulinSensitivitySchedule),
    maxBasalRate: s.maxBasalRate,
    maxBolus: s.maxBolus,
    insulinDurationHours: s.insulinDurationHours,
    capturedIso: s.capturedIso,
  };
}
