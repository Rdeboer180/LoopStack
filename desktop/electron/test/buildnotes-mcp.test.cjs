const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'buildnotes-mcp.mjs');

/** Spawn the server, send each request, and resolve with the replies by id. */
function talk(file, requests) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SCRIPT, file], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.on('error', reject);
    p.on('close', () => resolve(Object.fromEntries(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => [m.id, m]))));
    for (const r of requests) p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...r })}\n`);
    p.stdin.end();
  });
}
const call = (id, name) => ({ id, method: 'tools/call', params: { name, arguments: {} } });
const text = (m) => m.result.content[0].text;

test('lists exactly two read-only tools', async () => {
  const r = await talk('/nonexistent', [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' }]);
  assert.equal(r[1].result.serverInfo.name, 'loopstack-buildnotes');
  assert.deepEqual(r[2].result.tools.map((t) => t.name), ['get_build_notes', 'get_tracked_confidence']);
  assert.ok(r[2].result.tools.every((t) => t.annotations.readOnlyHint === true));
});

test('a missing file says so plainly', async () => {
  const r = await talk(path.join(os.tmpdir(), 'nope-build-notes.json'), [call(1, 'get_build_notes'), call(2, 'get_tracked_confidence')]);
  assert.equal(text(r[1]), 'No build notes yet. Open LoopStack on this Mac.');
  assert.equal(text(r[2]), 'No build notes yet. Open LoopStack on this Mac.');
});

test('reads the brief, staged items and grades, and never changes the file', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), 'build-notes.json');
  const doc = { v: 1, updated: '2026-11-22T10:00:00.000Z', scope: 'sample', brief: '# LoopStack next build\n### Insulin sensitivity (`isf`)', items: [
    { id: 'isf', state: 'staged', since: '2026-11-01', updated: '2026-11-05', history: [{ date: '2026-11-04', confidence: 'limited', reading: 40 }, { date: '2026-11-05', confidence: 'good', reading: 42 }] },
    { id: 'carbRatio', state: 'tracked', since: '2026-11-05', updated: '2026-11-05', history: [{ date: '2026-11-05', confidence: 'unusable', reading: null }] },
  ] };
  fs.writeFileSync(f, JSON.stringify(doc), { mode: 0o600 });
  const before = fs.readFileSync(f, 'utf8');
  const r = await talk(f, [call(1, 'get_build_notes'), call(2, 'get_tracked_confidence'), call(3, 'nope')]);
  assert.match(text(r[1]), /# LoopStack next build/);
  assert.match(text(r[1]), /- isf: tracked since 2026-11-01, 2 days tracked/);
  const items = JSON.parse(text(r[2]));
  assert.equal(items[0].grade, 'Readable');
  assert.equal(items[0].daysTracked, 2);
  assert.equal(items[1].grade, 'Not enough data');
  assert.equal(r[3].error.code, -32602);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('a file that is not ours reads as no notes', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), 'build-notes.json');
  fs.writeFileSync(f, '{"v":2}');
  const r = await talk(f, [call(1, 'get_build_notes')]);
  assert.equal(text(r[1]), 'No build notes yet. Open LoopStack on this Mac.');
});

test('lists a staged item only when the brief carries it, and flags the sample patient', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), 'build-notes.json');
  const row = (id) => ({ id, state: 'staged', since: '2026-11-01', updated: '2026-11-05', history: [] });
  fs.writeFileSync(f, JSON.stringify({ v: 1, updated: '2026-11-22T10:00:00.000Z', scope: 'sample', brief: '### Carb ratio (`carbRatio`)', items: [row('isf'), row('carbRatio')] }));
  const r = await talk(f, [call(1, 'get_build_notes')]);
  assert.match(text(r[1]), /- carbRatio:/);
  assert.doesNotMatch(text(r[1]), /- isf:/);
  assert.match(text(r[1]), /the sample patient: demo data/);
});

test('a null or non-object message is refused without stopping the server', async () => {
  const r = await talk('/nonexistent', [{ id: 1, method: 'tools/list' }]);
  assert.ok(r[1].result);
  const p = await new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT, '/nonexistent'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out));
    c.stdin.write('null\n[]\n' + JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }) + '\n');
    c.stdin.end();
  });
  assert.match(p, /Invalid request/);
  assert.match(p, /"id":9/);
});
