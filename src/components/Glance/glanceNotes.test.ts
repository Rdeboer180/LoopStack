import { describe, expect, it } from 'vitest';
import { lowTrendNote, stretches, weekNote } from './glanceNotes';

describe('glance notes', () => {
  it('names the lowest full day, leaving today out', () => {
    expect(weekNote([{ name: 'Fri', pct: 93, today: false }, { name: 'Sat', pct: 99, today: false }, { name: 'Today', pct: 40, today: true }])).toBe('Lowest Fri, 93%');
    expect(weekNote([{ name: 'Fri', pct: 97, today: false }, { name: 'Sat', pct: 99, today: false }])).toBe('Steady: 97% or more every day');
    expect(weekNote([{ name: 'Today', pct: 80, today: true }])).toBe('No full days counted yet');
  });
  it('splits days into stretches and reads which way they moved', () => {
    const t = stretches([4, 4, 3, null, 2, 2, 1, 1, 1], 3);
    expect(t).toEqual([3.7, 2, 1]);
    expect(lowTrendNote(t)).toBe('Down from 3.7% early in the period');
    expect(lowTrendNote([2, 2.2, 2.1])).toBe('About the same across the period');
  });
});
