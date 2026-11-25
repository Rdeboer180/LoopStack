import { describe, expect, it } from 'vitest';
import { glanceLayout, scopeMeals, scopeStats, sortGroups } from './FavoriteFoods';
import type { MealGroup } from '../data/meals';

describe('favorite foods widget size', () => {
  it('shows 8 four across at full width, 4 in a 2×2 narrower', () => {
    expect(glanceLayout(12, 11, false)).toEqual({ cols: 4, shown: 8, hidden: 3 });
    expect(glanceLayout(8, 11, false)).toEqual({ cols: 2, shown: 4, hidden: 7 });
  });
  it('Show more lists every food; nothing to show when they all fit', () => {
    expect(glanceLayout(8, 11, true).shown).toBe(11);
    expect(glanceLayout(12, 4, false)).toEqual({ cols: 4, shown: 4, hidden: 0 });
  });
});

describe('food sort', () => {
  const g = (name: string, n: number, high: number, low: number, high3 = 0) => ({
    name, n, outcomes: { in: n - high - low, high, low },
    buckets: { low3: 0, low2: 0, low1: low, in: n - high - low, high1: high - high3, high2: 0, high3 },
  }) as unknown as MealGroup;
  const groups = [g('A', 3, 0, 0), g('B', 9, 1, 0), g('C', 5, 2, 1), g('D', 4, 3, 0, 2)];
  const meals = [{ name: 'A', at: 400 }, { name: 'B', at: 100 }, { name: 'C', at: 300 }, { name: 'D', at: 200 }];
  it('recent (the default)', () => expect(sortGroups(groups, meals, 'recent').map((x) => x.name)).toEqual(['A', 'C', 'D', 'B']));
  it('most eaten', () => expect(sortGroups(groups, meals, 'most').map((x) => x.name)).toEqual(['B', 'C', 'D', 'A']));
  it('out of range: most times out first, the further out breaking ties', () => expect(sortGroups(groups, meals, 'out').map((x) => x.name)).toEqual(['D', 'C', 'B', 'A']));
});

describe('one food, all observed or the last 3', () => {
  const m = (at: number, observedMin: number | null, rise: number, outcome: 'in' | 'high' | 'low') =>
    ({ at, observedMin, enteredMin: 180, riseMgdl: rise, peakAfterMin: 60, peakMgdl: 110 + rise, outcome });
  const meals = [m(1, 200, 60, 'in'), m(5, 230, 90, 'high'), m(3, 210, 70, 'in'), m(4, 220, 95, 'high'), m(2, null, 50, 'in')];
  it('the last 3 are the newest three', () => expect(scopeMeals(meals, 'last3').map((x) => x.at)).toEqual([5, 4, 3]));
  it('all observed keeps every time, newest first', () => expect(scopeMeals(meals, 'all').map((x) => x.at)).toEqual([5, 4, 3, 2, 1]));
  it('stats follow the scope', () => {
    const all = scopeStats(meals);
    expect(all).toMatchObject({ n: 5, observedMin: 215, rise: 70, outcomes: { in: 3, high: 2, low: 0 } });
    const last = scopeStats(scopeMeals(meals, 'last3'));
    expect(last).toMatchObject({ n: 3, observedMin: 220, rise: 90, outcomes: { in: 1, high: 2, low: 0 } });
  });
});

describe('card window and sticker', () => {
  it('reads absorption time in half hours', async () => {
    const { halfHours } = await import('./FavoriteFoods');
    expect(halfHours(210)).toBe('3½h');
    expect(halfHours(45)).toBe('1h');
    expect(halfHours(80)).toBe('1½h');
    expect(halfHours(30)).toBe('½h');
    expect(halfHours(120)).toBe('2h');
  });
  it('spans the food’s own window, 1½h to 12h', async () => {
    const { cardSpan } = await import('./FavoriteFoods');
    expect(cardSpan(200, [])).toBe(210);
    expect(cardSpan(40, [])).toBe(90);
    expect(cardSpan(500, [])).toBe(510);
    expect(cardSpan(900, [])).toBe(720);
    expect(cardSpan(null, [])).toBe(90);
  });
  it('knows where a separate meal started, and says what came in', async () => {
    const { cutAt, addsLine } = await import('./FavoriteFoods');
    expect(cutAt({ splitMin: 180 })).toBe(180);
    expect(cutAt({ splitMin: null })).toBeNull();
    expect(addsLine({ adds: [] })).toBeNull();
    expect(addsLine({ adds: [{ min: 45, grams: 30, name: 'Gelato', sameMeal: true }] })).toBe('+30 g at 45m, same meal');
    expect(addsLine({ adds: [{ min: 180, grams: 25, name: 'Apple', sameMeal: false }] })).toBe('+25 g at 3h, a separate meal: dashed after');
    expect(addsLine({ adds: [{ min: 400, grams: 25, name: 'Apple', sameMeal: false }] }, 300)).toBeNull();
  });
});

describe('last ten times', () => {
  it('picks a kind for each time, dangerous ones apart', async () => {
    const { dotKind } = await import('./FavoriteFoods');
    expect(dotKind({ outcome: 'in', tier: 0 })).toBe('in');
    expect(dotKind({ outcome: 'high', tier: 1 })).toBe('high');
    expect(dotKind({ outcome: 'high', tier: 3 })).toBe('highX');
    expect(dotKind({ outcome: 'low', tier: 2 })).toBe('low');
    expect(dotKind({ outcome: 'low', tier: 3 })).toBe('lowX');
  });
  it('takes the newest ten, oldest first, and marks the newest three', async () => {
    const { lastTimes } = await import('./FavoriteFoods');
    const meals = Array.from({ length: 14 }, (_, i) => ({ at: i, outcome: 'in' as const, tier: 0 as const }));
    const dots = lastTimes(meals);
    expect(dots.map((d) => d.time.at)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(dots.filter((d) => d.recent).map((d) => d.time.at)).toEqual([11, 12, 13]);
    expect(lastTimes(meals.slice(0, 2)).every((d) => d.recent)).toBe(true);
  });
});

describe('chart duration', () => {
  it('labels a 12h axis every 2 hours', async () => {
    const { axisTicks } = await import('./FavoriteFoods');
    expect(axisTicks(720)).toEqual([0, 120, 240, 360, 480, 600, 720]);
    expect(axisTicks(300)).toEqual([0, 60, 120, 180, 240, 300]);
  });
  it('runs the axis as long as the longer of entered and observed, to the half hour', async () => {
    const { durationSpan } = await import('./FavoriteFoods');
    expect(durationSpan(180, 218)).toBe(240);
    expect(durationSpan(300, 120)).toBe(300);
    expect(durationSpan(60, 40)).toBe(90);
    expect(durationSpan(null, null)).toBe(90);
    expect(durationSpan(500, 400)).toBe(510);
    expect(durationSpan(600, 690)).toBe(690);
    expect(durationSpan(480, 800)).toBe(720);
    expect(durationSpan(null, 125)).toBe(150);
  });
  it('says how much longer or shorter than entered', async () => {
    const { durationDelta } = await import('./FavoriteFoods');
    expect(durationDelta(180, 218)).toEqual({ min: 38, text: '38m longer than entered' });
    expect(durationDelta(180, 120)).toEqual({ min: -60, text: '1h shorter than entered' });
    expect(durationDelta(180, 183)).toEqual({ min: 0, text: 'about what was entered' });
    expect(durationDelta(180, null)).toBeNull();
  });
  it('labels the axis to fit the span', async () => {
    const { axisTicks } = await import('./FavoriteFoods');
    expect(axisTicks(150)).toEqual([0, 30, 60, 90, 120, 150]);
    expect(axisTicks(240)).toEqual([0, 60, 120, 180, 240]);
  });
});
