import { describe, expect, it } from 'vitest';
import { weekRings } from './DayRings';
import type { DailyGlucose } from '../data/dataset';

const day = (i: number, pct: number | null, usable = true): DailyGlucose => ({
  day: `D${i}`, label: `Mon, Nov ${i}`, usable, meanMgdl: 140, p5: null, p25: null, p75: null, p95: null,
  inRangePct: pct, belowPct: 1, abovePct: 1, urgentPct: 0, std: null, readings: 288,
});

describe('weekly rings', () => {
  it('groups days into weeks ending on the last day, labelled by each week’s first day', () => {
    const days = Array.from({ length: 10 }, (_, i) => day(i + 1, 80));
    const w = weekRings(days);
    expect(w.map((x) => x.label)).toEqual(['Nov 1', 'Nov 4']);
    expect(w.map((x) => x.days)).toEqual([3, 7]);
    expect(w[0].pct).toBeNull(); // 3 days: under the 4 a week needs
    expect(w[1].pct).toBe(80);
  });
  it('averages only counted days', () => {
    const days = [day(1, 90), day(2, 70), day(3, null, false), day(4, 80), day(5, 60), day(6, 100), day(7, null, false)];
    expect(weekRings(days)[0]).toMatchObject({ pct: 80, counted: 5 });
  });
});
