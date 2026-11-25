// Glucose for one day: average, spread and time in range, from its readings.
import type { DailyGlucose } from './dataset';
import { BANDS, STANDARD, type Bands } from './ranges';

const q = (sorted: readonly number[], p: number) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Fewer readings than this and the day shows no numbers (under 2 hours of 5-minute CGM). */
export const MIN_READINGS = 24;

export function summariseDay(day: string, label: string, values: readonly number[], usable: boolean, b: Bands = BANDS): DailyGlucose {
  const v = [...values].sort((a, b) => a - b);
  if (v.length < MIN_READINGS) {
    return { day, label, usable: false, meanMgdl: null, p5: null, p25: null, p75: null, p95: null, inRangePct: null, belowPct: null, abovePct: null, urgentPct: null, std: null, readings: v.length };
  }
  const pct = (f: (x: number) => boolean) => r1((v.filter(f).length / v.length) * 100);
  return {
    day,
    label,
    usable,
    meanMgdl: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    p5: Math.round(q(v, 0.05)),
    p25: Math.round(q(v, 0.25)),
    p75: Math.round(q(v, 0.75)),
    p95: Math.round(q(v, 0.95)),
    inRangePct: pct((x) => x >= b.low && x <= b.high),
    belowPct: pct((x) => x < b.low),
    abovePct: pct((x) => x > b.high),
    urgentPct: pct((x) => x < b.urgentLow),
    std: { inRangePct: pct((x) => x >= STANDARD.low && x <= STANDARD.high), belowPct: pct((x) => x < STANDARD.low), abovePct: pct((x) => x > STANDARD.high) },
    readings: v.length,
  };
}
