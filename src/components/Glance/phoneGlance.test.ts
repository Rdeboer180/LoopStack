import { describe, expect, it } from 'vitest';
import { buildPhoneGlance, STALE_MIN } from './phoneGlance';
import type { GlucoseMetrics } from '@/data/types';

const NOW = new Date(2026, 10, 23, 12, 0);
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60000).toISOString();
const metrics = {
  range: '14d', targetLowMgdl: 65, targetHighMgdl: 180, urgentLowMgdl: 60, daysInWindow: 14, daysCovered: 14, hasPriorWindow: true,
  avgGlucose: 148.4, gmi: 6.8, cv: 34.2, sd: 50, tir: { veryLow: 2.4, low: 1, inRange: 74, high: 18.6, veryHigh: 4 },
  totalInsulin: 38.63, basalInsulin: 18, bolusInsulin: 20.6, carbs: 182, steps: 7200, exerciseMinutes: 28, sleepHours: 7,
  deltas: { avgGlucose: { value: -2, direction: 'good' }, inRange: { value: 3, direction: 'good' }, gmi: { value: 0, direction: 'neutral' }, cv: { value: 0, direction: 'neutral' } },
} as unknown as GlucoseMetrics;
const base = { recent: [{ iso: iso(10), mgdl: 118 }, { iso: iso(5), mgdl: 115 }, { iso: iso(1), mgdl: 112 }], metrics, closedLoopPct: 94, rhythm: null, periodLabel: '14d', now: NOW };

describe('phone glance', () => {
  it('leads with in range and the average', () => {
    const g = buildPhoneGlance({ ...base, current: { mgdl: 112, ratePer5min: -1.5, ratePer20min: -6, lastUpdatedIso: iso(1) } })!;
    expect(g.headline).toBe('74% in range, average 148');
    expect(g.tir.delta).toBe(3);
    expect(g.now.tone).toBe('in');
    expect(g.now.points.length).toBe(3);
  });
  it('greys a reading older than 15 minutes and says how old', () => {
    const g = buildPhoneGlance({ ...base, current: { mgdl: 112, ratePer5min: 0, ratePer20min: 0, lastUpdatedIso: iso(STALE_MIN + 4) } })!;
    expect(g.now.stale).toBe(true);
    expect(g.now.arrow).toBe('');
    expect(g.now.status).toBe(`Last reading ${STALE_MIN + 4} min ago, not live`);
  });
  it('names an urgent low from the profile line', () => {
    const g = buildPhoneGlance({ ...base, current: { mgdl: 57, ratePer5min: -2, ratePer20min: -8, lastUpdatedIso: iso(1) } })!;
    expect(g.now.status.startsWith('Urgent low')).toBe(true);
    expect(g.now.tone).toBe('low');
  });
  it('never shows a basal/bolus split', () => {
    const g = buildPhoneGlance({ ...base, current: null })!;
    expect(JSON.stringify(g)).not.toMatch(/basal|bolus/i);
    expect(g.insulin.cells.map((c) => c.label)).toEqual(['total', 'in automation', 'carbs']);
  });
  it('has nothing to draw with no glucose and no metrics', () => {
    expect(buildPhoneGlance({ ...base, metrics: null, current: null })).toBeNull();
  });
});
