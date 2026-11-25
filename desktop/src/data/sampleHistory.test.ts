import { describe, expect, it } from 'vitest';
import { sampleFor } from './sampleHistory';
import { SYNTHETIC } from './synthetic';

describe('sample history by period', () => {
  it('keeps the hand-written 14 days', () => expect(sampleFor(14)).toBe(SYNTHETIC));
  it.each([30, 90, 180])('builds %i days with every day and weekday group', (days) => {
    const t = performance.now();
    const ds = sampleFor(days);
    const ms = performance.now() - t;
    expect(ds.source).toBe('synthetic');
    expect(ds.PERIOD.days).toBe(days);
    expect(ds.DAYS.length).toBe(days);
    expect(ds.DAILY.days.length).toBe(days);
    expect(ds.DAY_BY_WEEKDAY.length).toBe(10);
    expect(ds.DAY_BY_WEEKDAY[8]?.name).toBe('weekday');
    expect(ds.READ.inRangePct).toBeGreaterThan(30);
    expect(ms).toBeLessThan(6000);
  });
});
