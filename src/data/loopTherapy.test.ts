import { describe, expect, it } from 'vitest';
import {
  carbRatioAt,
  dailyBasalTotal,
  formatScheduleTime,
  isfAt,
  minutesOfDay,
  rangeAt,
  realLoopTherapy,
  valueAt,
} from './loopTherapy';

const at = (h: number, m = 0) => {
  const d = new Date('2026-07-23T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
};

describe('valueAt', () => {
  const schedule = [
    { startMinutes: 0, value: 1 },
    { startMinutes: 360, value: 2 }, // 6:00
    { startMinutes: 780, value: 3 }, // 13:00
  ];

  it('returns the entry active at the given time', () => {
    expect(valueAt(schedule, 0)).toBe(1);
    expect(valueAt(schedule, 359)).toBe(1);
    expect(valueAt(schedule, 360)).toBe(2); // boundary is inclusive of the start
    expect(valueAt(schedule, 800)).toBe(3);
    expect(valueAt(schedule, 24 * 60 - 1)).toBe(3);
  });

  it('is safe on an empty schedule', () => {
    expect(valueAt([], 500)).toBe(0);
  });
});

describe("Ryan's real carb ratio schedule", () => {
  it('resolves the three real bands by clock time', () => {
    expect(carbRatioAt(realLoopTherapy, at(2))).toBe(27.8); // overnight
    expect(carbRatioAt(realLoopTherapy, at(13, 30))).toBe(28.5); // midday
    expect(carbRatioAt(realLoopTherapy, at(19))).toBe(25.5); // late
  });

  it('crosses the 1:00 PM boundary correctly', () => {
    expect(carbRatioAt(realLoopTherapy, at(12, 59))).toBe(27.8);
    expect(carbRatioAt(realLoopTherapy, at(13, 0))).toBe(28.5);
  });
});

describe("Ryan's real ISF schedule", () => {
  it('resolves the peak-sensitivity afternoon band', () => {
    expect(isfAt(realLoopTherapy, at(0))).toBe(40);
    expect(isfAt(realLoopTherapy, at(7))).toBe(45);
    expect(isfAt(realLoopTherapy, at(16))).toBe(50); // 3:30 PM band
    expect(isfAt(realLoopTherapy, at(23))).toBe(40);
  });
});

describe('rangeAt (correction range)', () => {
  it('resolves the widest band in the early morning', () => {
    expect(rangeAt(realLoopTherapy.correctionRange, minutesOfDay(at(6, 30)))).toEqual({
      low: 110,
      high: 130,
    });
    expect(rangeAt(realLoopTherapy.correctionRange, minutesOfDay(at(0)))).toEqual({
      low: 105,
      high: 115,
    });
  });
});

describe('dailyBasalTotal', () => {
  it('integrates the schedule to the total Loop reports', () => {
    // Loop's own display shows 14.82 U/day for this schedule.
    expect(dailyBasalTotal(realLoopTherapy)).toBeCloseTo(14.82, 2);
  });
});

describe('formatScheduleTime', () => {
  it('formats minutes as a 12-hour clock label', () => {
    expect(formatScheduleTime(0)).toBe('12:00 AM');
    expect(formatScheduleTime(13 * 60 + 30)).toBe('1:30 PM');
    expect(formatScheduleTime(12 * 60)).toBe('12:00 PM');
    expect(formatScheduleTime(23 * 60)).toBe('11:00 PM');
  });
});
