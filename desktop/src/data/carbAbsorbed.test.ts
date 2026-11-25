import { describe, expect, it } from 'vitest';
import { absorbEntries, absorbKey, anchorToCobZeros, cobZeros, DELAY_MIN, OVERRUN, stepsFromLoopCob } from './carbAbsorbed';

const T0 = Date.UTC(2026, 10, 20, 8, 51);
const MIN = 60_000;
const steps = (from: number, to: number, deviation: number, csf = 3) => {
  const out = [];
  for (let t = T0 + from * MIN; t <= T0 + to * MIN; t += 5 * MIN) out.push({ ms: t, deviation, csf });
  return out;
};

describe('observed absorption, Loop’s way', () => {
  it('with no counteraction an entry runs to Loop’s maximum time: 1.5× entered plus the 10-minute delay (1h 30m → 2h 25m)', () => {
    const r = absorbEntries([{ at: T0, grams: 14, absorptionMin: 90 }], [], T0 + 6 * 60 * MIN).get(absorbKey(T0, 14))!;
    expect(r.observedMin).toBe(90 * OVERRUN + DELAY_MIN);
    expect(r.absorbedG).toBe(14);
    expect(r.byObserved).toBe(false);
  });

  it('counteraction absorbs it faster than entered, like Loop’s yellow early finish', () => {
    // 6 mg/dL per 5 min at 3 mg/dL per gram = 2 g per step: 8 g in 4 steps (20 min), not the 2h 30m entered.
    const r = absorbEntries([{ at: T0, grams: 8, absorptionMin: 150 }], steps(5, 120, 6), T0 + 6 * 60 * MIN).get(absorbKey(T0, 8))!;
    expect(r.observedMin).toBe(20);
    expect(r.byObserved).toBe(true);
  });

  it('stays null while still absorbing at the end of the data', () => {
    const r = absorbEntries([{ at: T0, grams: 60, absorptionMin: 180 }], [], T0 + 60 * MIN).get(absorbKey(T0, 60))!;
    expect(r.observedMin).toBeNull();
    expect(r.absorbedG).toBeGreaterThan(0);
  });

  it('shares counteraction between overlapping entries by their rates, and only counts glucose insulin doesn’t explain', () => {
    const entries = [{ at: T0, grams: 30, absorptionMin: 60 }, { at: T0, grams: 20, absorptionMin: 180 }];
    const m = absorbEntries(entries, steps(5, 300, 4), T0 + 6 * 60 * MIN);
    // Same minute, kept apart. The faster entry (30 g/h) takes the bigger share, so it finishes first.
    const fast = m.get(absorbKey(T0, 30))!.observedMin!;
    const slow = m.get(absorbKey(T0, 20))!.observedMin!;
    expect(fast).toBeLessThan(slow);
    const negative = absorbEntries([{ at: T0, grams: 14, absorptionMin: 90 }], steps(5, 200, -5), T0 + 6 * 60 * MIN).get(absorbKey(T0, 14))!;
    expect(negative.observedMin).toBe(145); // falling glucose isn't absorption: it runs to Loop's maximum time
  });

  it('Loop’s minimum rate never finishes an entry early: only counteraction does', () => {
    // 60 g over 6 h with a trickle that covers 40 g by the 9 h maximum: Loop shows the full 9h 10m, not an early finish.
    const r = absorbEntries([{ at: T0, grams: 60, absorptionMin: 360 }], steps(5, 540, 1.1), T0 + 12 * 60 * MIN).get(absorbKey(T0, 60))!;
    expect(r.byObserved).toBe(false);
    expect(r.observedMin).toBe(360 * OVERRUN + DELAY_MIN);
  });

  it('a 🥜 delayed-metabolic dessert takes little of the early rise, so it finishes later than the same entry on Loop’s standard curve', () => {
    const dinner = { at: T0, grams: 40, absorptionMin: 150 };
    const dessert = { at: T0 + 60 * MIN, grams: 30, absorptionMin: 480 };
    const s = steps(5, 900, 2.2);
    const std = absorbEntries([dinner, dessert], s, T0 + 16 * 60 * MIN).get(absorbKey(dessert.at, 30))!;
    const delayed = absorbEntries([dinner, { ...dessert, kind: 'delayedMetabolicV1' as const }], s, T0 + 16 * 60 * MIN).get(absorbKey(dessert.at, 30))!;
    expect(delayed.observedMin!).toBeGreaterThan(std.observedMin!);
  });
});

describe('Loop’s own COB drives the count where Nightscout has it', () => {
  const at = (m: number) => T0 + m * MIN;
  it('turns COB drops into grams absorbed, adding entries logged in between', () => {
    const cob = [{ ms: at(0), cob: 10 }, { ms: at(5), cob: 48 }, { ms: at(10), cob: 44 }, { ms: at(60), cob: 40 }];
    const { steps, covered } = stepsFromLoopCob(cob, [{ at: at(3), grams: 40 }]);
    expect(steps.map((s) => s.deviation)).toEqual([2, 4]); // the 50-minute gap is too long to read
    expect(covered).toEqual([[at(0), at(10)]]);
  });
  it('pins the last entry of a run to the moment COB reaches zero; none finishes after it', () => {
    const out = new Map([[absorbKey(at(0), 350), { observedMin: 507, absorbedG: 350, byObserved: true }], [absorbKey(at(70), 22), { observedMin: 80, absorbedG: 22, byObserved: true }]]);
    anchorToCobZeros(out, [{ at: at(0), grams: 350 }, { at: at(70), grams: 22 }], cobZeros([{ ms: at(622), cob: 4 }, { ms: at(627), cob: 0 }]));
    expect(out.get(absorbKey(at(0), 350))!.observedMin).toBe(627); // 10h 27m, as Loop showed
    expect(out.get(absorbKey(at(70), 22))!.observedMin).toBe(80);
  });
});
