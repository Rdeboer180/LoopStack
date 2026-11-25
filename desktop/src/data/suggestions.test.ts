import { describe, expect, it } from 'vitest';
import { eligibleForBuild, readingLine, stepOf, type Suggestion } from './suggestions';
import { cleanTracked, recordReadings, type Tracked } from './tracked';

const s = (over: Partial<Suggestion>): Suggestion => ({ id: 'x', kind: 'setting', target: 'basal', label: 'Basal rate, 7–8am', unit: 'U/h', current: 1, reading: 1.1, confidence: 'good', evidence: '', note: '', ...over });

describe('SAFE-5a gate', () => {
  it('refuses non-finite and negative values before computing a percentage', () => {
    for (const value of [NaN, Infinity, -Infinity, -1, 0]) {
      expect(eligibleForBuild(s({ reading: value })).ok).toBe(false);
      expect(eligibleForBuild(s({ current: value })).ok).toBe(false);
    }
  });
  it('lets a readable reading within 20% through', () => {
    expect(eligibleForBuild(s({})).ok).toBe(true);
    expect(eligibleForBuild(s({ reading: 1.2 })).ok).toBe(true);
    expect(eligibleForBuild(s({ reading: 0.8 })).ok).toBe(true);
  });
  it('stops a step over 20%', () => {
    expect(eligibleForBuild(s({ reading: 1.21 }))).toEqual({ ok: false, reason: 'Over the 20% step' });
    expect(eligibleForBuild(s({ reading: 0.79 }))).toEqual({ ok: false, reason: 'Over the 20% step' });
  });
  it('needs the top confidence grade', () => {
    expect(eligibleForBuild(s({ confidence: 'limited' }))).toEqual({ ok: false, reason: 'Needs Readable confidence' });
    expect(eligibleForBuild(s({ confidence: 'unusable' }))).toEqual({ ok: false, reason: 'Not enough data yet' });
  });
  it('never takes a safety limit, whatever the data says', () => {
    for (const target of ['safetyLimit', 'maxBasal', 'maxBolus', 'guardrails'] as const) {
      expect(eligibleForBuild(s({ target, reading: 1.05 }))).toEqual({ ok: false, reason: 'Safety limit: stays in Loop' });
    }
  });
  it('has nothing to build without a reading or a change', () => {
    expect(eligibleForBuild(s({ reading: null })).ok).toBe(false);
    expect(eligibleForBuild(s({ reading: 1 })).ok).toBe(false);
  });
  it('words a reading as an observation', () => {
    expect(readingLine(s({ target: 'carbRatio', current: 10, reading: 9, unit: 'g per U' }))).toBe('On file 1:10. Readings point to 1:9 (10% lower).');
    expect(readingLine(s({}))).not.toMatch(/increase|lower your|change your|should/i);
    expect(stepOf(s({ current: 0 }))).toBeNull();
  });
});

describe('confidence history', () => {
  it('recovers malformed stored tracking without discarding valid choices', () => {
    expect(cleanTracked(null)).toEqual({});
    expect(cleanTracked([])).toEqual({});
    const clean = cleanTracked({ a: { state: 'tracked', since: 'Nov 1', history: null }, b: { state: 'staged', since: 'Nov 2', buildAs: 'branch', history: [{ date: 'Nov 2', confidence: 'good', reading: 1.1 }, { date: 'Nov 3', confidence: 'good', reading: NaN }] }, broken: null });
    expect(clean.a.history).toEqual([]);
    expect(clean.b.history).toHaveLength(1);
    expect(clean.b.buildAs).toBe('branch');
    expect(recordReadings(clean, 'Nov 4', [{ id: 'a', confidence: 'good', reading: 1 }]).a.history).toHaveLength(1);
  });
  const t: Tracked = { id: 'a', state: 'tracked', since: 'Nov 1', buildAs: 'code', history: [{ date: 'Nov 1', confidence: 'limited', reading: 1.1 }] };
  it('adds one reading a day to tracked items only', () => {
    const next = recordReadings({ a: t, b: { ...t, id: 'b', state: 'dismissed' } }, 'Nov 2', [{ id: 'a', confidence: 'good', reading: 1.1 }, { id: 'b', confidence: 'good', reading: 1 }]);
    expect(next.a.history).toHaveLength(2);
    expect(next.b.history).toHaveLength(1);
    const again = recordReadings(next, 'Nov 2', [{ id: 'a', confidence: 'good', reading: 1.2 }]);
    expect(again.a.history).toHaveLength(2);
  });
});

import { pumpStep } from './suggestions';
describe('basal readings in pump steps', () => {
  it('moves whole 0.05 U/h steps toward the reading, from the nearest grid rate', () => {
    expect(pumpStep(0.9, 0.82)).toBe(0.85);
    expect(pumpStep(0.92, 0.85)).toBe(0.85);
    expect(pumpStep(0.8, 0.83)).toBe(0.8);
    expect(pumpStep(0.8, 0.86)).toBe(0.85);
  });
});

import { badgeCounts } from './tracked';
describe('Suggestions nav badge', () => {
  const tr = (id: string, state: Tracked['state'] = 'tracked'): Tracked => ({ id, state, since: 'Nov 1', buildAs: 'code', history: [] });
  it('counts unseen untracked suggestions and tracked readings that newly passed the gate', () => {
    const all = [{ id: 'a', ready: false }, { id: 'b', ready: true }, { id: 'c', ready: true }, { id: 'd', ready: false }];
    expect(badgeCounts(all, {}, { ids: [], ready: [] })).toEqual({ fresh: 4, reached: 0, total: 4 });
    expect(badgeCounts(all, { b: tr('b'), d: tr('d') }, { ids: ['a', 'b', 'c', 'd'], ready: [] })).toEqual({ fresh: 0, reached: 1, total: 1 });
    expect(badgeCounts(all, { b: tr('b') }, { ids: ['a', 'b', 'c', 'd'], ready: ['b'] }).total).toBe(0);
    // Staged or hidden items aren't announced; hidden ones aren't new either.
    expect(badgeCounts(all, { b: tr('b', 'staged'), a: tr('a', 'dismissed') }, { ids: ['c', 'd'], ready: [] }).total).toBe(0);
  });
});
