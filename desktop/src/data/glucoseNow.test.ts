import { describe, expect, it } from 'vitest';
import { nowStatus, rates } from './glucoseNow';

const RYAN = { urgentLow: 60, low: 65, high: 180 };
const pts = (gs: number[]) => gs.map((g, i) => [10 + (i * 5) / 60, g] as const);

describe('glucose now', () => {
  it('reads the rate per 5 and per 20 minutes', () => {
    expect(rates(pts([100, 104, 108, 112, 116]))).toEqual({ per5: 4, per20: 16 });
    expect(rates(pts([100]))).toBeNull();
  });
  it('names urgent low and low from your bands', () => {
    expect(nowStatus(58, pts([70, 66, 62, 58]), RYAN)?.word).toBe('Urgent low');
    expect(nowStatus(63, pts([70, 68, 65, 63]), RYAN)?.tone).toBe('low');
  });
  it('says in range and the trend in plain words', () => {
    const s = nowStatus(112, pts([118, 116, 114, 112]), RYAN)!;
    expect(s.tone).toBe('in');
    expect(s.trend).toMatch(/Falling|Steady/);
  });
});
