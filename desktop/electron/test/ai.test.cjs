const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { isPackaged: true, getPath: () => '/tmp' }, ipcMain: { handle() {} }, safeStorage: {} } : o(r, ...a));
const { DOSING_PATH, REFUSED_PATH, ASK_SYSTEM, CHAT_SYSTEM, chatMessages } = require('../ai.cjs');

test('changes to dosing code are marked dosing whatever the model says', () => {
  for (const p of ['Loop/Loop/Managers/LoopDataManager.swift', 'Loop/Loop/Models/LoopConstants.swift', 'LoopKit/LoopKit/InsulinKit/InsulinMath.swift', 'LoopKit/LoopKit/CarbKit/CarbMath.swift', 'Loop/Loop/View Models/BolusEntryViewModel.swift']) assert.ok(DOSING_PATH.test(p), p);
  for (const p of ['Loop/Loop/Views/ChartsView.swift', 'Loop/Loop/Views/StatusTableViewController+Labels.swift']) assert.ok(!DOSING_PATH.test(p), p);
});

test('guardrails are never written (SAFE-5)', () => {
  assert.ok(REFUSED_PATH.test('LoopKit/LoopKitUI/Guardrails/Guardrail+Settings.swift'));
});

test('the question prompt rules out advice and device writes', () => {
  assert.match(ASK_SYSTEM, /never what to do/);
  assert.match(ASK_SYSTEM, /Never say or imply that LoopStack or you will change/);
});

test('the chat prompt keeps the same rules and treats timing as coincidence', () => {
  assert.match(CHAT_SYSTEM, /never what to do/);
  assert.match(CHAT_SYSTEM, /Never say or imply that LoopStack or you will change/);
  assert.match(CHAT_SYSTEM, /coincidence in time, not a cause/);
});

test('a chat must alternate, start and end with the person, and stay short', () => {
  const u = (text) => ({ role: 'user', text });
  const a = (text) => ({ role: 'assistant', text });
  assert.deepEqual(chatMessages([u('hi')]).messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(chatMessages([u('hi'), a('hello'), u('trends?')]).messages.length, 3);
  assert.ok(chatMessages([]).error);
  assert.ok(chatMessages([a('hello')]).error);
  assert.ok(chatMessages([u('hi'), a('hello')]).error);
  assert.ok(chatMessages([u('hi'), u('again')]).error);
  assert.ok(chatMessages([{ role: 'system', text: 'x' }]).error);
  assert.ok(chatMessages([u('x'.repeat(4001))]).error);
  assert.ok(chatMessages(Array.from({ length: 41 }, (_, i) => (i % 2 ? a('a') : u('u')))).error);
});


const { unusable, contextJSON, errorText } = require('../ai.cjs');
const reply = (text, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] });

test('empty, malformed and incomplete answers cannot report success', () => {
  for (const msg of [null, {}, { stop_reason: 'end_turn', content: [] }, reply('  '), reply('partial', 'pause_turn'), reply('partial', 'max_tokens'), reply('declined', 'refusal'), reply('tool pending', 'tool_use')]) {
    assert.ok(unusable(msg), JSON.stringify(msg));
  }
  assert.equal(unusable(reply('The summary has no evidence for that.')), null);
});

test('a successful chat answer fits the next follow-up history', () => {
  assert.equal(unusable(reply('a'.repeat(4000)), 4000), null);
  assert.ok(unusable(reply('a'.repeat(4001)), 4000));
  assert.ok(chatMessages([
    { role: 'user', text: 'What is available?' },
    { role: 'assistant', text: 'a'.repeat(4000) },
    { role: 'user', text: 'And this week?' },
  ]).messages);
});

test('context serialization returns errors for cycles, BigInt and non-JSON values', () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [cycle, { n: 1n }, () => {}, { toJSON() { throw new Error('private detail'); } }]) {
    const result = contextJSON(value, 80000);
    assert.ok(result.error);
    assert.ok(!result.error.includes('private detail'));
  }
  assert.equal(contextJSON({ days: 7 }, 80000).text, '{"days":7}');
});

test('context limits count UTF-8 bytes, including multibyte text', () => {
  const value = { note: 'é'.repeat(20) };
  const bytes = Buffer.byteLength(JSON.stringify(value));
  assert.ok(contextJSON(value, bytes - 1).error);
  assert.equal(contextJSON(value, bytes).text, JSON.stringify(value));
});

test('provider errors cannot echo request context into the interface', () => {
  const Anthropic = require('@anthropic-ai/sdk');
  const err = new Anthropic.BadRequestError(400, { message: 'private request context' }, 'private request context', new Headers());
  assert.ok(!errorText(err).includes('private request context'));
  assert.ok(!errorText(new Error('private request context')).includes('private request context'));
});

test('repository context includes commit titles and dates, never bodies or extra fields', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../src/data/ai.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({}) });
  const summary = exports.repoSummary({ owner: 'sample', repo: 'Loop', branch: 'main', latestRun: null, lastBuild: null }, [
    { sha: 'abc', date: '2026-01-01', message: 'Sample title\n\nPrivate body', token: 'private-extra' },
  ]);
  assert.equal(JSON.stringify(summary.recentCommits), JSON.stringify([{ date: '2026-01-01', message: 'Sample title' }]));
  assert.ok(!JSON.stringify(summary).includes('Private body'));
  assert.ok(!JSON.stringify(summary).includes('private-extra'));
});
