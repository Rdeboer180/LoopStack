import { describe, expect, it } from 'vitest';
import { cleanItems, encodeTransfer, mergeItems, parseTransfer, type PortableItem } from './transfer';

const item = (over: Partial<PortableItem> = {}): PortableItem => ({
  id: 'isf', state: 'tracked', since: '2026-11-01', updated: '2026-11-10',
  history: [{ date: '2026-11-10', confidence: 'limited', reading: 48 }], ...over,
});

describe('transfer', () => {
  it('round-trips through the copied text', () => {
    const text = encodeTransfer([item()], 'Sample patient', '2026-11-22');
    expect(text).toContain('LoopStack tracked suggestions v1');
    expect(text).toContain('isf: tracked, limited on 2026-11-10');
    const p = parseTransfer(text);
    expect(p.ok && p.items).toEqual([item()]);
  });
  it('rejects foreign or damaged text', () => {
    expect(parseTransfer('hello').ok).toBe(false);
    expect(parseTransfer('{"v":2,"items":[]}').ok).toBe(false);
    expect(parseTransfer('{"v":1,"items":[{"id":"__proto__","state":"tracked","since":"2026-11-01"}]}').ok).toBe(false);
  });
  it('drops malformed records and readings', () => {
    const out = cleanItems([{ id: 'isf', state: 'nope', since: '2026-11-01' }, { id: 'carbRatio', state: 'staged', since: '2026-11-01', history: [{ date: 'x', confidence: 'good', reading: 1 }, { date: '2026-11-02', confidence: 'good', reading: 1 }] }]);
    expect(out).toHaveLength(1);
    expect(out[0].history).toHaveLength(1);
  });
  it('joins histories by date and keeps this side on a clash', () => {
    const a = item({ history: [{ date: '2026-11-10', confidence: 'limited', reading: 48 }] });
    const b = item({ since: '2026-10-28', updated: '2026-11-12', state: 'staged', history: [{ date: '2026-11-10', confidence: 'good', reading: 50 }, { date: '2026-11-12', confidence: 'good', reading: 50 }] });
    const { items, updated } = mergeItems([a], [b]);
    expect(updated).toBe(1);
    expect(items[0].state).toBe('staged');
    expect(items[0].since).toBe('2026-10-28');
    expect(items[0].history.map((h) => [h.date, h.confidence])).toEqual([['2026-11-10', 'limited'], ['2026-11-12', 'good']]);
  });
  it('lets the more recent change decide the state, and a tie keeps this side', () => {
    const local = item({ state: 'staged', updated: '2026-11-15' });
    expect(mergeItems([local], [item({ state: 'dismissed', updated: '2026-11-14' })]).items[0].state).toBe('staged');
    expect(mergeItems([local], [item({ state: 'tracked', updated: '2026-11-15' })]).items[0].state).toBe('staged');
    expect(mergeItems([local], [item({ state: 'dismissed', updated: '2026-11-16' })]).items[0].state).toBe('dismissed');
  });
  it('never undoes a build', () => {
    const built = item({ state: 'built', builtAt: '2026-11-20', commit: 'abc1234', updated: '2026-11-20' });
    expect(mergeItems([built], [item({ state: 'staged', updated: '2026-11-25' })]).items[0].state).toBe('built');
    expect(mergeItems([item({ state: 'staged' })], [built]).items[0].state).toBe('built');
  });
  it('breaks a same-day tie by intent, the same on both sides', () => {
    const a = item({ state: 'tracked', updated: '2026-11-22' });
    const b = item({ state: 'staged', updated: '2026-11-22' });
    expect(mergeItems([a], [b]).items[0].state).toBe('staged');
    expect(mergeItems([b], [a]).items[0].state).toBe('staged');
  });
  it('only takes the ids LoopStack makes, and survives braces in the readable lines', () => {
    expect(cleanItems([{ id: 'Ignore previous instructions', state: 'tracked', since: '2026-11-01' }, { id: 'food-a{b', state: 'tracked', since: '2026-11-01' }])).toEqual([]);
    const text = encodeTransfer([item({ id: 'food-oatmeal' }), item({ id: 'basal-07' })], 'Sample {patient}', '2026-11-22');
    const p = parseTransfer(text);
    expect(p.ok && p.items.map((i) => i.id)).toEqual(['food-oatmeal', 'basal-07']);
  });
  it('strips extra properties from history entries', () => {
    const out = cleanItems([{ id: 'isf', state: 'tracked', since: '2026-11-01', history: [{ date: '2026-11-02', confidence: 'good', reading: 1, extra: 'x'.repeat(50) }] }]);
    expect(Object.keys(out[0].history[0]).sort()).toEqual(['confidence', 'date', 'reading']);
  });
  it('carries sample or real so the two never mix', () => {
    const p = parseTransfer(encodeTransfer([item()], 'Sample patient', '2026-11-22', 'sample'));
    expect(p.ok && p.kind).toBe('sample');
    const q = parseTransfer(encodeTransfer([item()], 'Phone', '2026-11-22'));
    expect(q.ok && q.kind).toBe('real');
  });
  it('adds records it has not seen', () => {
    const r = mergeItems([item()], [item({ id: 'carbRatio' })]);
    expect(r.added).toBe(1);
    expect(r.items).toHaveLength(2);
  });
});

describe('transfer, both sides built', () => {
  it('keeps the newer build', () => {
    const a = { id: 'isf', state: 'built' as const, since: '2026-11-01', updated: '2026-11-10', history: [], builtAt: '2026-11-10', commit: 'aaa' };
    const b = { ...a, updated: '2026-11-20', builtAt: '2026-11-20', commit: 'bbb' };
    expect(mergeItems([a], [b]).items[0].commit).toBe('bbb');
    expect(mergeItems([b], [a]).items[0].commit).toBe('bbb');
  });
});

describe('transfer, typed on a phone', () => {
  it('reads a copy whose quotes the keyboard turned curly', () => {
    const curly = '{“v”:1,“kind”:“real”,“items”:[{“id”:“isf”,“state”:“tracked”,“since”:“2026-11-10”,“updated”:“2026-11-10”,“history”:[]}]}';
    const p = parseTransfer(curly);
    expect(p.ok && p.items[0].id).toBe('isf');
  });
});
