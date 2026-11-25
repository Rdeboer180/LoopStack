import { describe, expect, it } from 'vitest';
import { bandOf, bandRead, highTierOf, isStandard, lowTierOf, STANDARD } from './ranges';

const RYAN = { urgentLow: 60, low: 65, high: 180 };

describe('your ranges', () => {
  it('places a reading in your bands', () => {
    expect([59, 60, 64, 65, 180, 181, 250, 251].map((g) => bandOf(g, RYAN))).toEqual(['urgent', 'low', 'low', 'in', 'in', 'high', 'high', 'veryHigh']);
    expect(bandOf(62, STANDARD)).toBe('low');
    expect(bandOf(53, STANDARD)).toBe('urgent');
  });
  it('reads five bands that add to 100', () => {
    const r = bandRead([50, 62, 100, 120, 200, 300, 140, 150, 160, 170], RYAN);
    expect(r).toEqual({ urgentPct: 10, lowPct: 10, inRangePct: 60, highPct: 10, veryHighPct: 10 });
    expect(bandRead([], RYAN).inRangePct).toBe(0);
  });
  it('tiers a meal from your bands', () => {
    expect([65, 64, 60, 59, 55, 54].map((g) => lowTierOf(g, RYAN))).toEqual([0, 1, 1, 2, 2, 3]);
    expect([180, 181, 201, 221].map((g) => highTierOf(g, RYAN))).toEqual([0, 1, 2, 3]);
  });
  it('knows the standard bands', () => {
    expect(isStandard(STANDARD)).toBe(true);
    expect(isStandard(RYAN)).toBe(false);
  });
});
