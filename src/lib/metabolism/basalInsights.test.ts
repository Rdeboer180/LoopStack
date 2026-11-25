import { describe, expect, it } from 'vitest';
import { computeBasalInsights, findFastingWindows } from './basalInsights';
import { realLoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

const NOW = new Date('2026-07-22T12:00:00');
const DAY = 24 * 3600_000;

/** Readings every 5 min from `startMs`, drifting `driftMgdl` over `hours`. */
function series(startMs: number, hours: number, from: number, driftMgdl: number): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  const steps = (hours * 60) / 5;
  for (let i = 0; i <= steps; i++) {
    out.push({
      iso: new Date(startMs + i * 5 * 60_000).toISOString(),
      mgdl: Math.round(from + (driftMgdl * i) / steps),
    });
  }
  return out;
}

/** Midnight-to-6am on the Nth day back. */
function nightStart(daysAgo: number): number {
  const d = new Date(NOW.getTime() - daysAgo * DAY);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe('findFastingWindows', () => {
  it('finds a quiet overnight stretch', () => {
    const w = findFastingWindows(series(nightStart(1), 5, 110, 0), [], []);
    expect(w).toHaveLength(1);
    expect(w[0].minutes).toBe(300);
    expect(w[0].startHour).toBe(0);
  });

  it('excludes a stretch shadowed by a meal', () => {
    const start = nightStart(1);
    const carbs: CarbEntry[] = [
      { iso: new Date(start + 60 * 60_000).toISOString(), grams: 40, absorptionHours: 3 },
    ];
    // The carb shadow splits the night; neither remainder is long enough.
    const w = findFastingWindows(series(start, 5, 110, 0), carbs, []);
    expect(w.every((x) => x.minutes >= 120)).toBe(true);
    expect(w.length).toBeLessThanOrEqual(1);
  });

  it('excludes a stretch shadowed by a bolus', () => {
    const start = nightStart(1);
    const insulin: InsulinEvent[] = [
      { iso: new Date(start + 30 * 60_000).toISOString(), units: 2, kind: 'bolus' },
    ];
    const w = findFastingWindows(series(start, 4, 110, 0), [], insulin);
    expect(w).toHaveLength(0);
  });

  it('ignores temp basals — they are the thing being measured', () => {
    const start = nightStart(1);
    const insulin: InsulinEvent[] = [
      { iso: new Date(start + 60 * 60_000).toISOString(), units: 0.3, kind: 'basal_temp' },
    ];
    expect(findFastingWindows(series(start, 5, 110, 0), [], insulin)).toHaveLength(1);
  });

  it('breaks a window across a CGM gap', () => {
    const start = nightStart(1);
    const first = series(start, 3, 110, 0);
    const second = series(start + 5 * 3600_000, 3, 110, 0); // 2h gap
    const w = findFastingWindows([...first, ...second], [], []);
    expect(w).toHaveLength(2);
  });

  it('returns nothing without glucose', () => {
    expect(findFastingWindows([], [], [])).toEqual([]);
  });
});

describe('computeBasalInsights', () => {
  const therapy = realLoopTherapy;

  it('needs several quiet nights before reading a block', () => {
    const r = computeBasalInsights({
      glucose: series(nightStart(1), 5, 110, 40),
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 14,
      now: NOW,
    });
    const overnight = r.blocks.find((b) => b.label === 'Overnight')!;
    expect(overnight.verdict).toBe('building');
    expect(r.suggestions).toEqual([]);
  });

  it('calls a consistent overnight rise a drift worth reviewing', () => {
    const glucose = [1, 2, 3, 4, 5].flatMap((d) => series(nightStart(d), 5, 105, 45));
    const r = computeBasalInsights({
      glucose,
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 14,
      now: NOW,
    });
    const overnight = r.blocks.find((b) => b.label === 'Overnight')!;
    expect(overnight.verdict).toBe('drifts_up');
    expect(overnight.windowCount).toBe(5);
    expect(overnight.consistencyPct).toBe(100);
    expect(r.suggestions.some((s) => /Overnight/.test(s))).toBe(true);
  });

  it('calls a flat night flat, and stays quiet about it', () => {
    const glucose = [1, 2, 3, 4, 5].flatMap((d) => series(nightStart(d), 5, 110, 2));
    const r = computeBasalInsights({
      glucose,
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 14,
      now: NOW,
    });
    const overnight = r.blocks.find((b) => b.label === 'Overnight')!;
    expect(overnight.verdict).toBe('flat');
    expect(r.suggestions.some((s) => /Overnight/.test(s))).toBe(false);
  });

  it('never issues a rate instruction', () => {
    const glucose = [1, 2, 3, 4, 5].flatMap((d) => series(nightStart(d), 5, 105, 45));
    const r = computeBasalInsights({
      glucose, carbs: [], insulin: [], therapy, windowDays: 14, now: NOW,
    });
    for (const line of [...r.suggestions, ...r.blocks.map((b) => b.note)]) {
      expect(line).not.toMatch(/increase|decrease|raise|lower|set (your )?basal|U\/hr to/i);
    }
  });

  it('flags a sustained gap between delivered and scheduled basal', () => {
    const r = computeBasalInsights({
      glucose: [], carbs: [], insulin: [], therapy, windowDays: 14, now: NOW,
      deliveredDailyU: 20, // schedule is ~14.8
    });
    expect(r.deliveryDeltaU).toBeGreaterThan(0);
    expect(r.suggestions.some((s) => /more basal than the schedule/.test(s))).toBe(true);
  });

  it('says nothing about delivery when the source cannot measure basal', () => {
    const r = computeBasalInsights({
      glucose: [], carbs: [], insulin: [], therapy, windowDays: 14, now: NOW,
      deliveredDailyU: null,
    });
    expect(r.deliveredDailyU).toBeNull();
    expect(r.deliveryDeltaU).toBeNull();
    expect(r.suggestions).toEqual([]);
  });

  it('reports the scheduled daily total', () => {
    const r = computeBasalInsights({
      glucose: [], carbs: [], insulin: [], therapy, windowDays: 14, now: NOW,
    });
    expect(r.scheduledDailyU).toBeGreaterThan(10);
    expect(r.scheduledDailyU).toBeLessThan(20);
  });
});
