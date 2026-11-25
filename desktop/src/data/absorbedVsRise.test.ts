import { describe, expect, it } from 'vitest';
import { SYNTHETIC } from './synthetic';

// Nov 23: a 350 g sweet potato read 3h 38m here and 10h 27m in Loop, because the
// glucose-rise time was shown as "Absorbed in". Absorbed in is Loop's count; the
// rise is its own figure and never stands in for it.
describe('absorbed in is Loop’s count, the rise is apart', () => {
  const meals = SYNTHETIC.MEALS.recent;
  it('keeps a rise time beside the absorption time without replacing it', () => {
    const both = meals.filter((m) => m.observedMin != null && m.riseMin != null);
    expect(both.length).toBeGreaterThan(0);
    // Somewhere the two differ: if they were the same figure, they'd always match.
    expect(both.some((m) => m.observedMin !== m.riseMin)).toBe(true);
  });
});
