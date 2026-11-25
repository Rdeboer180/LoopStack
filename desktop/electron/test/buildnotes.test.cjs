const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { getPath: () => os.tmpdir() }, BrowserWindow: {}, dialog: {}, ipcMain: { handle() {} } } : o(r, ...a));
const { buildDocument, MAX_BYTES } = require('../buildnotes.cjs');
const { writeAtomic } = require('../atomic.cjs');

const good = { id: 'isf', state: 'staged', since: '2026-11-01', updated: '2026-11-05', history: [{ date: '2026-11-05', confidence: 'good', reading: 42 }] };

test('a valid save becomes a v1 document with cleaned items and the brief', () => {
  const r = buildDocument({ scope: 'sample', items: [good, { id: '__proto__' }], brief: '# LoopStack next build' }, new Date('2026-11-22T10:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.doc.v, 1);
  assert.equal(r.doc.updated, '2026-11-22T10:00:00.000Z');
  assert.equal(r.doc.items.length, 1);
  assert.equal(r.doc.brief, '# LoopStack next build');
});

test('the brief is optional', () => {
  const r = buildDocument({ scope: 'ns-abc12', items: [good] });
  assert.equal(r.ok, true);
  assert.equal('brief' in r.doc, false);
});

test('bad scope, missing items and oversize payloads are refused', () => {
  assert.equal(buildDocument({ scope: '../x', items: [] }).ok, false);
  assert.equal(buildDocument({ scope: 'sample', items: 'no' }).ok, false);
  assert.equal(buildDocument(null).ok, false);
  const many = Array.from({ length: 3000 }, (_, i) => ({ ...good, id: `food-${i}`, history: Array.from({ length: 60 }, (_, d) => ({ date: `2026-10-${String((d % 28) + 1).padStart(2, '0')}`, confidence: 'good', reading: 12.3456 })) }));
  const r = buildDocument({ scope: 'sample', items: many });
  assert.equal(r.ok, false);
  assert.ok(MAX_BYTES === 900 * 1024);
});

test('writeAtomic leaves the file at mode 0600 and no temp file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  const f = path.join(dir, 'build-notes.json');
  writeAtomic(f, '{"a":1}');
  writeAtomic(f, '{"a":2}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['build-notes.json']);
});
