import { describe, expect, it } from 'vitest';
import { weekdayRows, weekdayTrend, type WeekdayMeal } from './mealWeekday';

const B = { low: 65, high: 180 };
// Nov 2026: Mon 16 … Sun 22; Fri is the 20th.
const t = (day: number, hour = 13) => new Date(2026, 10, day, hour).getTime();
const m = (day: number, outcome: WeekdayMeal['outcome'], hour = 13): WeekdayMeal => ({ at: t(day, hour), outcome, peakMgdl: outcome === 'high' ? 220 : 150, lowMgdl: outcome === 'low' ? 58 : 90 });

describe('a food by day of the week', () => {
  it('counts each weekday, Monday first', () => {
    const rows = weekdayRows([m(20, 'low'), m(13, 'low'), m(16, 'in')]);
    expect(rows[0]).toMatchObject({ weekday: 1, n: 1, inRange: 1 });
    expect(rows[4]).toMatchObject({ weekday: 5, n: 2, low: 2 });
  });

  it('says when there are too few times', () => {
    expect(weekdayTrend([m(20, 'low'), m(13, 'low')], null, B, 'Pizza').kind).toBe('few');
  });

  it('a weekday that stands out with the day quiet otherwise: the food and the day together', () => {
    const meals = [m(20, 'low'), m(13, 'low'), m(16, 'in'), m(17, 'in'), m(18, 'in')];
    const r = weekdayTrend(meals, () => ({ lowPct: 2, highPct: 5 }), B, 'Pizza');
    expect(r.kind).toBe('meal+weekday');
    expect(r.weekday).toBe(5);
    expect(r.note).toMatch(/Pizza on a Friday together/);
  });

  it('the same, but that weekday runs low on any food: the day is the thread', () => {
    const meals = [m(20, 'low'), m(13, 'low'), m(16, 'in'), m(17, 'in'), m(18, 'in')];
    const r = weekdayTrend(meals, (wd) => (wd === 5 ? { lowPct: 30, highPct: 0 } : null), B, 'Pizza');
    expect(r.kind).toBe('weekday');
    expect(r.note).toMatch(/Other foods on Fridays run low at those hours too/);
  });

  it('out of range most times on every weekday: it follows the food', () => {
    const meals = [m(16, 'high'), m(17, 'high'), m(18, 'high'), m(19, 'high'), m(20, 'in')];
    const r = weekdayTrend(meals, null, B, 'Pasta');
    expect(r.kind).toBe('meal');
    expect(r.note).toMatch(/4 of 5 times went above 180/);
  });

  it('counts each side apart when a food goes both ways', () => {
    const meals = [m(16, 'high'), m(17, 'high'), m(18, 'low'), m(19, 'high'), m(20, 'high')];
    expect(weekdayTrend(meals, null, B, 'Burrito').note).toMatch(/^4 of 5 times went above 180 \(and 1 below 65\)/);
  });

  it('nothing stands out', () => {
    expect(weekdayTrend([m(16, 'in'), m(17, 'in'), m(18, 'high'), m(19, 'in')], null, B, 'Salad').kind).toBe('none');
  });

  it('never words a cause or an instruction', () => {
    const meals = [m(20, 'low'), m(13, 'low'), m(16, 'in'), m(17, 'in'), m(18, 'in')];
    for (const h of [null, () => ({ lowPct: 30, highPct: 0 })]) {
      expect(weekdayTrend(meals, h, B, 'Pizza').note).not.toMatch(/\b(because|caused|should|try|reduce|increase|bolus)\b/i);
    }
  });
});
