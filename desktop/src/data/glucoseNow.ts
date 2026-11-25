// The phone's glucose status on the desktop: the same classifier
// (glucoseStatus.ts, scored against your bands) and the same trend words, from
// the last readings on the Glucose now tile. A plain state, never an
// instruction (SAFE-1): the phone's meal advisory copy is not carried over.
import { classifyGlucose, classifyTrend, trendLabel, type GlucoseStatus } from '@/lib/glucoseStatus';
import { BANDS, type Bands } from './ranges';
import type { Pt } from './dataset';

export interface NowStatus { key: GlucoseStatus | 'urgent_low'; word: string; trend: string; tone: 'low' | 'high' | 'in' }

/** Rate from readings as [hour, mg/dL]: per 5 minutes from the last two, and over the last 20 minutes. */
export function rates(points: readonly Pt[]): { per5: number; per20: number } | null {
  if (points.length < 2) return null;
  const [t1, g1] = points[points.length - 1];
  const [t0, g0] = points[points.length - 2];
  const dt = (t1 - t0) * 60;
  if (!(dt > 0)) return null;
  const back = [...points].reverse().find(([t]) => (t1 - t) * 60 >= 20) ?? points[0];
  const span = (t1 - back[0]) * 60;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { per5: r1(((g1 - g0) / dt) * 5), per20: span > 0 ? r1(((g1 - back[1]) / span) * 20) : 0 };
}

export function nowStatus(mgdl: number | null, points: readonly Pt[], b: Bands = BANDS): NowStatus | null {
  const r = rates(points);
  if (mgdl == null || !r) return null;
  const trend = trendLabel[classifyTrend(r.per5)];
  if (mgdl < b.urgentLow) return { key: 'urgent_low', word: 'Urgent low', trend, tone: 'low' };
  const key = classifyGlucose({ mgdl, ratePer5min: r.per5, ratePer20min: r.per20, lastUpdatedIso: new Date().toISOString() });
  const word: Record<GlucoseStatus, string> = { low: 'Low', urgent_high: 'High', high_falling: 'High, coming down', elevated_rising: 'In range', in_range: 'In range' };
  return { key, word: word[key], trend, tone: key === 'low' ? 'low' : key === 'urgent_high' || key === 'high_falling' ? 'high' : 'in' };
}
