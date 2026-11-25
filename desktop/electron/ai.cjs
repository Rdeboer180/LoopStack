// AI connector (step 4 of docs/desktop/loop-branch-plan.md), main process only.
//
// The person's own Anthropic API key, in the keychain (safeStorage), used for:
//   ai:ask    a question about their own dashboard numbers (PRODUCT.md SAFE-7):
//             the page sends a summary it has shown the person; no raw
//             readings, no Nightscout address or token.
//   ai:chat   a back-and-forth conversation about trends and recent changes:
//             the same summary, plus what LoopStack read of their Loop repo
//             (version, patches, customizations, builds, the branch's recent
//             commit titles), all shown on the page before the first message.
//   ai:draft  a custom feature for their Loop: Claude picks the Loop source
//             files it needs, then returns those files changed. LoopStack
//             makes the diff itself, checks it applies, marks dosing changes,
//             and refuses therapy-value changes (SAFE-5). The draft stays here;
//             the page only gets to review and approve it.
//   ai:commit commits an approved draft to patches/ (SAFE-3: reviewed, plus a
//             second confirmation for dosing changes).
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { readConfig: readGithub, gh } = require('./github.cjs');
const { buildReader } = require('./library.cjs');
const { checkPatch } = require('./patchcheck.cjs');
const { unifiedDiff } = require('./favorites.cjs');

const MODEL = 'claude-opus-5-5';
// Server-side fallback on a policy decline: the API re-runs the request on a
// fallback model chosen by refusal category, inside the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const file = () => path.join(app.getPath('userData'), 'ai.json');

// ------------------------------------------------------------ key

function readKey() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return c.key && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(c.key, 'base64')) : '';
  } catch {
    return '';
  }
}

function client(apiKey = readKey()) {
  // A fake API can stand in while developing; the packaged app always talks to Anthropic.
  const baseURL = !app.isPackaged && process.env.LOOPSTACK_ANTHROPIC_BASE_URL ? process.env.LOOPSTACK_ANTHROPIC_BASE_URL : undefined;
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 2 });
}

function errorText(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic didn’t accept the API key.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use that model.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting this key. Try again in a minute.';
  if (err instanceof Anthropic.BadRequestError) return 'Anthropic couldn’t take that request. Try a shorter request.';
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic. Check the connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic answered ${err.status}.`;
  return 'The AI request failed. Try again.';
}

/** Stop reasons that mean the answer can't be used as is. */
function unusable(msg, maxText = Infinity) {
  if (!msg || !Array.isArray(msg.content)) return 'Claude returned an unreadable answer. Try again.';
  if (msg.stop_reason === 'refusal') return 'Claude declined this request.';
  if (msg.stop_reason === 'max_tokens') return 'The answer ran past its length limit. Try a narrower request.';
  if (msg.stop_reason !== 'end_turn') return 'Claude did not finish this answer. Try again.';
  const text = textOf(msg).trim();
  if (!text) return 'Claude returned no text. Try again.';
  if (text.length > maxText) return 'The answer is too long for this chat. Try a narrower question.';
  return null;
}
const textOf = (msg) => msg.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');

function contextJSON(value, limit) {
  try {
    const text = JSON.stringify(value ?? {});
    if (typeof text !== 'string') return { error: 'The context couldn’t be read. Start a new request.' };
    if (Buffer.byteLength(text, 'utf8') > limit) return { error: 'The context is too large to send.' };
    return { text };
  } catch {
    return { error: 'The context couldn’t be read. Start a new request.' };
  }
}

// ------------------------------------------------------------ ask

const ASK_SYSTEM = `You answer questions from a person who uses Loop, the open-source automated insulin delivery app, about their own data in LoopStack.

You get a JSON summary of the numbers LoopStack already computed for them. Use only those numbers. If the summary doesn't hold what the question needs, say what's missing.

Rules, which the app also checks before showing your answer:
- Say what the data shows, never what to do. No dosing instructions, no "take/eat X", no "increase/lower your basal, carb ratio, ISF, targets or limits", no suggested settings values of any kind.
- Never say or imply that LoopStack or you will change their pump, Loop or settings.
- Don't claim a change caused an outcome; say what happened after it.
- Name the sample behind a claim (for example "on 11 of 13 usable days").
- If they ask what to change, say that's a decision for them and their care team, and point to the numbers worth bringing to that conversation.
- Plain words, short paragraphs, mg/dL units.`;

// ------------------------------------------------------------ chat

const CHAT_SYSTEM = `You chat with a person who uses Loop, the open-source automated insulin delivery app, about trends in their own data and recent changes to their Loop, in LoopStack.

You get a JSON context: the numbers LoopStack already computed from their data, and, if their Loop repo is connected, what LoopStack read of it (Loop version, patches, customizations, recent builds and the branch's recent commit titles). Use only that context and the conversation. If it doesn't hold what a question needs, say what's missing. You can explain what Loop features and settings are in general terms.

When talking about a change and the data around it, line them up by date and say what happened before and after; a commit title or a settings change next to a shift in the numbers is a coincidence in time, not a cause.

Rules, which the app also checks before showing each reply:
- Say what the data shows, never what to do. No dosing instructions, no "take/eat X", no "increase/lower your basal, carb ratio, ISF, targets or limits", no suggested settings values of any kind.
- Never say or imply that LoopStack or you will change their pump, Loop, repo or settings. Code changes go through Build a feature, which they review themselves.
- Don't claim a change caused an outcome; say what happened after it.
- Name the sample behind a claim (for example "on 11 of 13 usable days").
- If they ask what to change, say that's a decision for them and their care team, and point to the numbers worth bringing to that conversation.
- Plain words, short paragraphs, mg/dL units.`;

const CHAT_TURNS = 40;
const CHAT_TEXT = 4000;

/** The conversation as the API takes it, or a reason it can't be sent. */
function chatMessages(list) {
  if (!Array.isArray(list) || !list.length) return { error: 'Say something first.' };
  if (list.length > CHAT_TURNS) return { error: 'This chat is long. Start a new one.' };
  const out = [];
  for (const [i, m] of list.entries()) {
    const role = m?.role === 'user' ? 'user' : m?.role === 'assistant' ? 'assistant' : null;
    const text = String(m?.text ?? '').trim();
    if (!role || !text) return { error: 'The chat couldn’t be read. Start a new one.' };
    if (text.length > CHAT_TEXT) return { error: 'Keep each message under 4,000 characters.' };
    if (role !== (i % 2 === 0 ? 'user' : 'assistant')) return { error: 'The chat couldn’t be read. Start a new one.' };
    out.push({ role, content: text });
  }
  if (out[out.length - 1].role !== 'user') return { error: 'Say something first.' };
  return { messages: out };
}

// ------------------------------------------------------------ draft a feature

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'Paths from the list, at most 6.' },
    reason: { type: 'string' },
  },
  required: ['files', 'reason'],
  additionalProperties: false,
};

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short name for the feature, under 50 characters.' },
    summary: { type: 'string', description: 'What it changes, for the person, in two or three sentences.' },
    changesDosing: { type: 'boolean', description: 'True if it changes what Loop doses, how it predicts, its limits, or what it is told about carbs, insulin or glucose.' },
    changesTherapyValues: { type: 'boolean', description: 'True if it sets or changes any therapy setting value (basal rates, carb ratios, sensitivity, targets, maximums, guardrails).' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, newContent: { type: 'string', description: 'The whole file after the change.' } },
        required: ['path', 'newContent'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'changesDosing', 'changesTherapyValues', 'files'],
  additionalProperties: false,
};

const DRAFT_SYSTEM = `You write small customizations for a person's own build of Loop (LoopKit/Loop and LoopKit/LoopKit, Swift). The person builds and installs it themselves; nothing you write runs until they review it, approve it, build it and install it.

Rules:
- Change as little as possible, in the files given. Keep everything else in each file byte for byte, including whitespace and comments.
- Return each changed file whole. Don't return files you didn't change.
- Never set or change therapy setting values (basal rates, carb ratios, insulin sensitivity, correction ranges, maximum basal or bolus, guardrails). If the request needs that, change nothing, return no files, and say why in the summary.
- Never remove authentication, confirmations or safety checks.
- Mark changesDosing true for anything that affects dosing, prediction, limits, or carb, insulin or glucose inputs.
- Compile-ready Swift that matches the surrounding code's style.`;

// Files where a change is a dosing change regardless of what the model says.
const DOSING_PATH = /(LoopAlgorithm|DoseMath|LoopDataManager|LoopConstants|Prediction|Insulin|Bolus|Basal|Carb|Dose|Override|Glucose|Therapy|Settings|Guardrail|Automatic|Retrospective|Momentum)/i;
// Files whose change is a therapy-limit change: refused outright (SAFE-5).
const REFUSED_PATH = /Guardrail/i;

const drafts = new Map();

async function swiftPaths(cfg) {
  const out = [];
  for (const seg of ['Loop', 'LoopKit']) {
    let sub;
    try {
      sub = (await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${seg}?ref=${encodeURIComponent(cfg.branch)}`)).data;
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
    if (sub?.type !== 'submodule') continue;
    const m = String(sub.submodule_git_url || '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!m) continue;
    const { data } = await gh(cfg.token, 'GET', `/repos/${m[1]}/${m[2]}/git/trees/${sub.sha}?recursive=1`);
    for (const t of data.tree || []) {
      if (t.type === 'blob' && t.path.endsWith('.swift') && !/Tests?\//.test(t.path)) out.push(`${seg}/${t.path}`);
    }
  }
  return out;
}

const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'feature';

function register() {
  ipcMain.handle('ai:config', () => ({ connected: Boolean(readKey()), model: MODEL }));

  ipcMain.handle('ai:connect', async (_e, input) => {
    const key = String(input?.apiKey || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, error: 'That doesn’t look like an Anthropic API key (it starts with sk-ant-).' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This Mac’s keychain isn’t available, so the key can’t be stored safely.' };
    try {
      await client(key).models.retrieve(MODEL);
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ key: safeStorage.encryptString(key).toString('base64') }), { mode: 0o600 });
    return { ok: true, model: MODEL };
  });

  ipcMain.handle('ai:disconnect', () => {
    try { fs.rmSync(file(), { force: true }); } catch { /* already gone */ }
    drafts.clear();
    return { ok: true };
  });

  ipcMain.handle('ai:ask', async (_e, input) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'Add your Anthropic API key in Settings first.' };
    const question = String(input?.question || '').trim();
    const summary = contextJSON(input?.summary, 60_000);
    if (summary.error) return { ok: false, error: summary.error };
    if (!question || question.length > 2000) return { ok: false, error: 'Ask a question of up to 2,000 characters.' };
    try {
      const stream = client(key).beta.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        ...FALLBACK,
        output_config: { effort: 'medium' },
        system: ASK_SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `My LoopStack data summary:\n${summary.text}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: question },
        ] }],
      });
      const msg = await stream.finalMessage();
      const bad = unusable(msg);
      if (bad) return { ok: false, error: bad };
      return { ok: true, answer: textOf(msg), model: msg.model };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('ai:chat', async (_e, input) => {
    const key = readKey();
    if (!key) return { ok: false, error: 'Add your Anthropic API key in Settings first.' };
    const chat = chatMessages(input?.messages);
    if (chat.error) return { ok: false, error: chat.error };
    const context = contextJSON(input?.context, 80_000);
    if (context.error) return { ok: false, error: context.error };
    // The context rides in front of the first message, cached, so later turns re-send it cheaply.
    const [first, ...rest] = chat.messages;
    const messages = [{ role: 'user', content: [
      { type: 'text', text: `My LoopStack context:\n${context.text}`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: first.content },
    ] }, ...rest];
    try {
      const msg = await client(key).beta.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        ...FALLBACK,
        output_config: { effort: 'medium' },
        system: CHAT_SYSTEM,
        messages,
      }).finalMessage();
      const bad = unusable(msg, CHAT_TEXT);
      if (bad) return { ok: false, error: bad };
      return { ok: true, answer: textOf(msg), model: msg.model };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('ai:draft', async (_e, input) => {
    const key = readKey();
    const cfg = readGithub();
    if (!key) return { ok: false, error: 'Add your Anthropic API key in Settings first.' };
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    const description = String(input?.description || '').trim();
    if (description.length < 10 || description.length > 3000) return { ok: false, error: 'Describe the feature in 10 to 3,000 characters.' };
    try {
      const ai = client(key);
      const all = await swiftPaths(cfg);
      if (!all.length) return { ok: false, error: 'Couldn’t list your Loop’s source files.' };
      // 1. Which files the change needs.
      const pickMsg = await ai.beta.messages.stream({
        model: MODEL,
        max_tokens: 4000,
        ...FALLBACK,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
        system: 'Pick the Loop source files a customization would need to change. Choose only from the list given, at most 6.',
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Source files:\n${all.join('\n')}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `The customization: ${description}` },
        ] }],
      }).finalMessage();
      const bad1 = unusable(pickMsg);
      if (bad1) return { ok: false, error: bad1 };
      const picked = [...new Set((JSON.parse(textOf(pickMsg)).files || []).filter((p) => all.includes(p)))].slice(0, 6);
      if (!picked.length) return { ok: false, error: 'Claude didn’t find files in your Loop to change for that.' };
      // 2. The change itself, against the person's exact source.
      const read = buildReader(cfg);
      const sources = {};
      for (const p of picked) { const t = await read(p); if (t != null) sources[p] = t; }
      const writeMsg = await ai.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        ...FALLBACK,
        output_config: { effort: 'high', format: { type: 'json_schema', schema: WRITE_SCHEMA } },
        system: DRAFT_SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'text', text: Object.entries(sources).map(([p, t]) => `=== ${p}\n${t}`).join('\n\n'), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `The customization: ${description}` },
        ] }],
      }).finalMessage();
      const bad2 = unusable(writeMsg);
      if (bad2) return { ok: false, error: bad2 };
      const out = JSON.parse(textOf(writeMsg));
      if (out.changesTherapyValues) return { ok: false, error: `Not drafted: it would change therapy setting values, which LoopStack never writes (SAFE-5). ${out.summary}` };
      const changed = (out.files || []).filter((f) => sources[f.path] != null && f.newContent !== sources[f.path]);
      if (!changed.length) return { ok: false, error: out.summary || 'Claude made no change.' };
      if (changed.some((f) => REFUSED_PATH.test(f.path))) return { ok: false, error: 'Not drafted: it changes Loop’s guardrails, which LoopStack never writes (SAFE-5).' };
      const slug = slugOf(out.title);
      let patch = changed.map((f) => unifiedDiff(f.path, sources[f.path], f.newContent)).join('');
      patch += `diff --git a/loopstack_${slug}.loopcustomization b/loopstack_${slug}.loopcustomization\nnew file mode 100644\nindex 0000000..e69de29\n`;
      const check = await checkPatch(patch, read);
      if (check.status !== 'apply') return { ok: false, error: 'The drafted change doesn’t apply cleanly to your Loop. Try describing it again.' };
      const dosing = Boolean(out.changesDosing) || changed.some((f) => DOSING_PATH.test(f.path));
      const id = crypto.randomUUID();
      drafts.set(id, { patch, slug, title: out.title, summary: out.summary, dosing, description, model: writeMsg.model });
      return { ok: true, id, title: out.title, summary: out.summary, dosing, files: check.summary, patch };
    } catch (err) {
      if (err instanceof SyntaxError) return { ok: false, error: 'Claude’s answer wasn’t in the expected shape. Try again.' };
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('ai:commit', async (_e, input) => {
    const cfg = readGithub();
    const d = drafts.get(String(input?.id || ''));
    if (!cfg.token || !d) return { ok: false, error: 'That draft is gone. Draft it again.' };
    if (input?.reviewed !== true) return { ok: false, error: 'Review the change first.' };
    if (d.dosing && input?.confirmDosing !== true) return { ok: false, error: 'This one changes dosing. Confirm that separately before it’s added.' };
    try {
      const check = await checkPatch(d.patch, buildReader(cfg));
      if (check.status !== 'apply') return { ok: false, error: 'The change doesn’t apply to your Loop any more. Draft it again.' };
      const p = `patches/loopstack_${d.slug}.patch`;
      let sha;
      try { sha = (await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${p}?ref=${encodeURIComponent(cfg.branch)}`)).data?.sha; } catch (e) { if (e.status !== 404) throw e; }
      const { data } = await gh(cfg.token, 'PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${p}`, {
        message: [
          `LoopStack: add ${d.title} (drafted with Claude)`,
          '',
          d.summary,
          '',
          `Asked for: ${d.description.slice(0, 500)}`,
          `Drafted by ${d.model} from the description above; reviewed and approved in LoopStack.`,
          `Changes dosing: ${d.dosing ? 'yes, confirmed separately in LoopStack' : 'no'}`,
          `Files: ${check.summary.map((f) => f.path).join(', ')}`,
        ].join('\n'),
        content: Buffer.from(d.patch, 'utf8').toString('base64'),
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      });
      drafts.delete(String(input.id));
      return { ok: true, commit: { sha: data?.commit?.sha, url: data?.commit?.html_url } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { unusable, contextJSON, errorText, register, DOSING_PATH, REFUSED_PATH, ASK_SYSTEM, CHAT_SYSTEM, chatMessages };
