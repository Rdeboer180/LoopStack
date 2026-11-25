const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { getPath: () => os.tmpdir(), on() {} }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, ipcMain: { handle() {} } } : o(r, ...a));
const { syncFolder, readFolderFile, fileName } = require('../foldersync.cjs');

const item = (o = {}) => ({ id: 'isf', state: 'tracked', since: '2026-11-01', updated: '2026-11-05', history: [{ date: '2026-11-05', confidence: 'good', reading: 42 }], ...o });
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));

test('the first sync writes loopstack-tracked-<scope>.json and nothing else', () => {
  const d = dir();
  const r = syncFolder(d, 'sample', [item()]);
  assert.equal(r.ok, true);
  assert.equal(r.wrote, true);
  assert.equal(r.changedLocal, false);
  assert.deepEqual(fs.readdirSync(d), [fileName('sample')]);
  assert.equal(fs.statSync(path.join(d, fileName('sample'))).mode & 0o777, 0o600);
});

test('the folder teaches this Mac: merged result is written back and flagged', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, fileName('sample')), JSON.stringify({ v: 1, scope: 'sample', updated: 'x', items: [item({ id: 'carbRatio' }), item({ history: [{ date: '2026-11-06', confidence: 'limited', reading: 40 }], updated: '2026-11-06', state: 'staged' })] }));
  const r = syncFolder(d, 'sample', [item()]);
  assert.equal(r.changedLocal, true);
  const byId = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(byId.isf.state, 'staged');
  assert.equal(byId.isf.history.length, 2);
  assert.ok(byId.carbRatio);
  assert.equal(readFolderFile(d, 'sample').length, 2);
});

test('a second sync of the same records changes nothing', () => {
  const d = dir();
  syncFolder(d, 'sample', [item()]);
  const r = syncFolder(d, 'sample', [item()]);
  assert.equal(r.wrote, false);
  assert.equal(r.changedLocal, false);
});

test('built stays built from either side', () => {
  const d = dir();
  syncFolder(d, 'sample', [item({ state: 'built', builtAt: '2026-11-06', commit: 'abc', updated: '2026-11-06' })]);
  const r = syncFolder(d, 'sample', [item({ state: 'staged', updated: '2026-11-09' })]);
  assert.equal(r.items[0].state, 'built');
});

test('damaged, foreign or other-scope files read as empty and are never trusted', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, fileName('sample')), 'not json');
  assert.deepEqual(readFolderFile(d, 'sample'), []);
  fs.writeFileSync(path.join(d, fileName('sample')), JSON.stringify({ v: 1, scope: 'ns-abc', items: [item()] }));
  assert.deepEqual(readFolderFile(d, 'sample'), []);
  assert.equal(syncFolder(d, '../evil', [item()]).ok, false);
});

test('other files in the folder are left alone', () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'notes.txt'), 'mine');
  syncFolder(d, 'sample', [item()]);
  assert.equal(fs.readFileSync(path.join(d, 'notes.txt'), 'utf8'), 'mine');
  assert.deepEqual(fs.readdirSync(d).sort(), ['loopstack-tracked-sample.json', 'notes.txt']);
});

test('an unreadable folder file is never written over', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  fs.writeFileSync(path.join(d, fileName('sample')), '{ not json');
  const r = syncFolder(d, 'sample', [{ id: 'isf', state: 'tracked', since: '2026-11-01', updated: '2026-11-01', history: [] }]);
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(d, fileName('sample')), 'utf8'), '{ not json');
});
