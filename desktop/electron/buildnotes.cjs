// Build notes on disk: the tracked records and the brief, written to one JSON
// file in this app's user-data folder so an LLM you run yourself can read them
// through scripts/buildnotes-mcp.mjs (read-only). The renderer sends them when
// they change; this validates, size-caps and writes atomically. Observations
// only (SAFE-1): nothing here touches Loop, a pump or a pod.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { cleanItems } = require('./tracked.cjs');
const { writeAtomic } = require('./atomic.cjs');

const MAX_BYTES = 900 * 1024;
const MAX_BRIEF = 120 * 1024;
const SCOPE = /^[a-z0-9-]{1,40}$/;
const FILE = 'build-notes.json';

/** The document to write, or an error. Pure. */
function buildDocument(input, now = new Date()) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Nothing to save.' };
  if (typeof input.scope !== 'string' || !SCOPE.test(input.scope)) return { ok: false, error: 'Unknown data source.' };
  if (!Array.isArray(input.items)) return { ok: false, error: 'No records to save.' };
  const doc = { v: 1, updated: now.toISOString(), scope: input.scope, items: cleanItems(input.items) };
  if (typeof input.brief === 'string' && input.brief.trim()) doc.brief = input.brief.slice(0, MAX_BRIEF);
  const text = JSON.stringify(doc);
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, error: 'That is too large to save.' };
  return { ok: true, doc, text };
}

const notesPath = () => path.join(app.getPath('userData'), FILE);
const scriptPath = () => path.resolve(__dirname, '..', '..', 'scripts', 'buildnotes-mcp.mjs');

/** `after(scope, items)` runs once a save is written (folder sync hangs off it). */
function register(after) {
  ipcMain.handle('buildnotes:save', async (_e, input) => {
    const r = buildDocument(input);
    if (!r.ok) return r;
    try {
      // The sample patient is a demo: it never overwrites the notes an LLM may read.
      if (r.doc.scope !== 'sample') {
        fs.mkdirSync(path.dirname(notesPath()), { recursive: true });
        writeAtomic(notesPath(), r.text);
      }
      const sync = after ? after(r.doc.scope, r.doc.items) : null;
      return sync ? { ok: true, sync } : { ok: true };
    } catch {
      return { ok: false, error: 'Could not save the build notes.' };
    }
  });
  ipcMain.handle('buildnotes:paths', async () => ({ ok: true, script: scriptPath(), file: notesPath(), scriptExists: fs.existsSync(scriptPath()) }));
}

module.exports = { register, buildDocument, MAX_BYTES };
