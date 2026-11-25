const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanItems, mergeItems } = require('../tracked.cjs');

const item = (o = {}) => ({ id: 'isf', state: 'tracked', since: '2026-11-01', updated: '2026-11-05', history: [{ date: '2026-11-05', confidence: 'good', reading: 42 }], ...o });

test('cleanItems drops damaged, foreign and prototype ids, and never repairs', () => {
  const out = cleanItems([item(), item({ id: '__proto__' }), item({ id: 'x'.repeat(81) }), item({ state: 'nope' }), item({ since: 'yesterday' }), null, 'x']);
  assert.deepEqual(out.map((i) => i.id), ['isf']);
  assert.deepEqual(cleanItems('nope'), []);
});

test('cleanItems keeps only good history rows and commit/builtAt for built', () => {
  const [a] = cleanItems([item({ history: [{ date: '2026-11-05', confidence: 'good', reading: 1 }, { date: 'bad', confidence: 'good', reading: 1 }, { date: '2026-11-06', confidence: 'great', reading: 1 }, { date: '2026-11-07', confidence: 'limited', reading: Infinity }], commit: 'abc', builtAt: '2026-11-06' })]);
  assert.equal(a.history.length, 1);
  assert.equal(a.commit, undefined);
  const [b] = cleanItems([item({ state: 'built', commit: 'a'.repeat(60), builtAt: '2026-11-06' })]);
  assert.equal(b.commit.length, 40);
  assert.equal(b.builtAt, '2026-11-06');
});

test('mergeItems joins histories by date and keeps the earlier since', () => {
  const local = [item({ history: [{ date: '2026-11-05', confidence: 'good', reading: 42 }] })];
  const inc = [item({ since: '2026-10-30', updated: '2026-11-04', history: [{ date: '2026-11-04', confidence: 'limited', reading: 40 }, { date: '2026-11-05', confidence: 'unusable', reading: 1 }] })];
  const r = mergeItems(local, inc);
  assert.equal(r.items[0].since, '2026-10-30');
  assert.deepEqual(r.items[0].history.map((h) => h.date), ['2026-11-04', '2026-11-05']);
  assert.equal(r.items[0].history[1].confidence, 'good', 'a day already on this side is not overwritten');
  assert.equal(r.updated, 1);
});

test('the later updated side decides the state; a tie keeps local', () => {
  assert.equal(mergeItems([item({ state: 'tracked', updated: '2026-11-05' })], [item({ state: 'staged', updated: '2026-11-06' })]).items[0].state, 'staged');
  assert.equal(mergeItems([item({ state: 'tracked', updated: '2026-11-06' })], [item({ state: 'staged', updated: '2026-11-05' })]).items[0].state, 'tracked');
  assert.equal(mergeItems([item({ state: 'tracked' })], [item({ state: 'staged' })]).items[0].state, 'staged');
});

test('built is final in both directions', () => {
  const built = item({ state: 'built', updated: '2026-11-01', builtAt: '2026-11-01', commit: 'abc' });
  assert.equal(mergeItems([built], [item({ state: 'staged', updated: '2026-11-09' })]).items[0].state, 'built');
  assert.equal(mergeItems([item({ state: 'staged', updated: '2026-11-09' })], [built]).items[0].state, 'built');
});

test('new ids are added, and merging the same records is a no-op', () => {
  const r = mergeItems([item()], [item({ id: 'carbRatio' })]);
  assert.equal(r.added, 1);
  const again = mergeItems(r.items, r.items);
  assert.equal(again.added + again.updated, 0);
});
