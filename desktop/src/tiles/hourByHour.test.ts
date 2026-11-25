import { describe, expect, it } from 'vitest';
import { hourRows, MIN_DAYS } from './HourByHour';
import { inPick } from '../ui/Focus';

describe('hour by hour', () => {
  const days = ['Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6', 'Sat 7', 'Sun 8'];
  const hourly = Object.fromEntries(days.map((d, i) => [d, Array.from({ length: 24 }, (_, h) => (h === 16 ? 60 + i : h === 20 ? 190 : 120))]));
  it('reads an hour only with enough days, and counts lows and highs', () => {
    const all = hourRows(days, hourly, 'all');
    expect(all[16]).toMatchObject({ hour: 16, median: 63, low: 5, high: 0, days: 7 }); // 60–64 are below the default 65
    expect(all[20].high).toBe(7);
    const weekend = hourRows(days, hourly, 'wke');
    expect(weekend[16].days).toBe(2);
    expect(weekend[16].median).toBeNull(); // under MIN_DAYS
    expect(MIN_DAYS).toBe(5);
  });
  it('picks days by their labels', () => {
    expect(inPick('Fri, Oct 30', 'wkd')).toBe(true);
    expect(inPick('Sat 7', 'wkd')).toBe(false);
    expect(inPick('Sun 8', 'sun')).toBe(true);
  });
});
