import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoptLegacy, badgeNow, displayDay, isoDay, setTrackScope, toPortable, trackScope, withoutForgotten, type Tracked } from './tracked';
import { foodId } from './suggestions';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const staged = (id: string) => JSON.stringify({ [id]: { id, state: 'staged', since: 'Nov 1', buildAs: 'code', history: [] } });

describe('tracked suggestions are kept per data source', () => {
  afterEach(() => { setTrackScope('sample'); vi.unstubAllGlobals(); });

  it('names one store for the sample patient and one per Nightscout site', () => {
    expect(trackScope('synthetic', 'https://a.example')).toBe('sample');
    const a = trackScope('nightscout', 'https://Mine.example.com/');
    expect(a).toMatch(/^ns-[0-9a-z]+$/);
    expect(trackScope('nightscout', 'mine.example.com')).toBe(a);
    expect(trackScope('nightscout', 'https://other.example.com')).not.toBe(a);
    expect(trackScope('nightscout', '')).toBe('ns');
    // No address in the key.
    expect(a).not.toContain('example');
  });

  it('a suggestion staged on the sample patient is not staged on Nightscout', () => {
    const store = memory();
    vi.stubGlobal('window', { localStorage: store });
    store.setItem('loopstack.tracked.sample', staged('isf'));
    const items = [{ id: 'isf', ready: true }];
    expect(badgeNow(items).fresh).toBe(0);
    setTrackScope(trackScope('nightscout', 'https://mine.example.com'));
    expect(badgeNow(items).fresh).toBe(1);
  });

  it('the first Nightscout site takes over the store from before partitioning', () => {
    const store = memory();
    store.setItem('loopstack.tracked', staged('isf'));
    store.setItem('loopstack.suggestionsSeen', '{"ids":["isf"],"ready":[]}');
    adoptLegacy(store, 'ns-abc');
    expect(store.getItem('loopstack.tracked.ns-abc')).toBe(staged('isf'));
    expect(store.getItem('loopstack.suggestionsSeen.ns-abc')).toContain('isf');
    expect(store.getItem('loopstack.tracked')).toBeNull();
    // Nothing left for a second site, and the first keeps its own.
    adoptLegacy(store, 'ns-def');
    expect(store.getItem('loopstack.tracked.ns-def')).toBeNull();
  });

  it('the sample patient and an unknown site leave the old store alone; an existing site store wins', () => {
    const store = memory();
    store.setItem('loopstack.tracked', staged('isf'));
    adoptLegacy(store, 'sample');
    adoptLegacy(store, 'ns');
    expect(store.getItem('loopstack.tracked')).toBe(staged('isf'));
    store.setItem('loopstack.tracked.ns-abc', staged('carbRatio'));
    adoptLegacy(store, 'ns-abc');
    expect(store.getItem('loopstack.tracked.ns-abc')).toBe(staged('carbRatio'));
    expect(store.getItem('loopstack.tracked')).toBeNull();
  });
});

describe('days cross between the app format and the portable one', () => {
  const now = new Date(2026, 10, 22);
  it('turns "Nov 13" into a portable day and back', () => {
    expect(isoDay('Nov 13', now)).toBe('2026-11-13');
    expect(isoDay('Dec 30', now)).toBe('2025-12-30');
    expect(isoDay('2026-11-13', now)).toBe('2026-11-13');
    expect(displayDay('2026-11-03')).toBe('Nov 3');
    expect(displayDay('nonsense')).toBe('nonsense');
  });
  it('a sample record with "Nov 13" days is not dropped when copied', () => {
    const t: Tracked = { id: 'basal-07', state: 'staged', since: 'Nov 13', buildAs: 'code', history: [{ date: 'Nov 13', confidence: 'good', reading: 0.85 }], updated: 'Nov 13' };
    const out = toPortable({ 'basal-07': t }, undefined, false, now);
    expect(out).toHaveLength(1);
    expect(out[0].since).toBe('2026-11-13');
    expect(out[0].history[0].date).toBe('2026-11-13');
  });
});

describe('stopping tracking', () => {
  const rec = (id: string, updated: string) => ({ id, state: 'tracked' as const, since: '2026-11-01', updated, history: [] });
  it('keeps a stopped item from coming back unless it changed after', () => {
    const gone = { isf: '2026-11-20' };
    expect(withoutForgotten([rec('isf', '2026-11-20'), rec('carbRatio', '2026-11-20')], gone).map((i) => i.id)).toEqual(['carbRatio']);
    expect(withoutForgotten([rec('isf', '2026-11-21')], gone).map((i) => i.id)).toEqual(['isf']);
  });
});

describe('food ids', () => {
  it('fit the shared format and never collide for long or non-Latin names', () => {
    expect(foodId('Pad Thai')).toBe('food-pad-thai');
    const long = foodId('a'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(65);
    expect(long).toMatch(/^food-[a-z0-9-]{1,60}$/);
    expect(foodId('寿司')).not.toBe(foodId('ラーメン'));
    expect(foodId('寿司')).toMatch(/^food-[a-z0-9]+$/);
  });
});

import { ringTakeaway, weakestDay } from '../ui/DayRings';
describe('ring takeaway', () => {
  const day = (label: string, pct: number | null, usable = true) => ({ day: label, label, usable, inRangePct: pct } as never);
  it('names the weakest day only when it is 15 or more under the period', () => {
    expect(weakestDay([day('Mon, Nov 2', 72), day('Tue, Nov 3', 70)], 74)).toBeNull();
    expect(weakestDay([day('Mon, Nov 2', 72), day('Tue, Nov 3', 55)], 74)).toBe('Tue, Nov 3 was lowest at 55% in range.');
    expect(ringTakeaway([day('Mon, Nov 2', 72), day('Tue, Nov 3', 55), day('Wed, Nov 4', 20, false)], 74)).toBe('74% in range over 2 counted days. Tue, Nov 3 was lowest at 55% in range.');
    expect(ringTakeaway([], 74)).toBe('No days counted yet.');
  });
});
