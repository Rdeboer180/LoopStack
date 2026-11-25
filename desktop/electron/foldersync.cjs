// Folder sync: an optional folder (an iCloud Drive folder works) where this app
// keeps one file per data source, loopstack-tracked-<scope>.json. On change it
// merges the folder's file into the local records and writes the merged result
// back; it also checks the file when the window gains focus. It reads and
// writes only that one file name in the folder, and nothing about Loop, a
// pump or a pod. Off until the person chooses a folder.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { cleanItems, mergeItems } = require('./tracked.cjs');
const { writeAtomic } = require('./atomic.cjs');

const SCOPE = /^[a-z0-9-]{1,40}$/;
const MAX_BYTES = 900 * 1024;
const fileName = (scope) => `loopstack-tracked-${scope}.json`;

/** Read the folder's file for a scope. Missing, oversized or damaged reads as no records. */
function readFolderFile(folder, scope) {
  return readFolderState(folder, scope).items;
}

/** status: 'missing' (safe to create), 'ok', or 'unreadable' (never written over: it may be another Mac's records). */
function readFolderState(folder, scope) {
  if (!SCOPE.test(scope)) return { status: 'unreadable', items: [] };
  const file = path.join(folder, fileName(scope));
  try {
    if (fs.existsSync(path.join(folder, '.' + fileName(scope) + '.icloud'))) return { status: 'unreadable', items: [] };
    if (fs.statSync(file).size > MAX_BYTES) return { status: 'unreadable', items: [] };
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && v.v === 1 && v.scope === scope ? { status: 'ok', items: cleanItems(v.items) } : { status: 'unreadable', items: [] };
  } catch (err) {
    return { status: err && err.code === 'ENOENT' ? 'missing' : 'unreadable', items: [] };
  }
}

/**
 * Merge `local` with the folder's file and write the result back if the file
 * would change. `changedLocal` says the folder taught this Mac something.
 */
function syncFolder(folder, scope, local, now = new Date()) {
  if (!SCOPE.test(scope)) return { ok: false, error: 'Unknown data source.' };
  const clean = cleanItems(local);
  const state = readFolderState(folder, scope);
  if (state.status === 'unreadable') return { ok: false, error: 'The sync file in that folder could not be read, so nothing was written. If it is in iCloud Drive, let it finish downloading.' };
  const fromFolder = state.items;
  const merged = mergeItems(clean, fromFolder);
  const items = merged.items;
  const changedLocal = merged.added > 0 || merged.updated > 0;
  const canon = (list) => JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)));
  const same = canon(items) === canon(fromFolder);
  if (!same) {
    const text = JSON.stringify({ v: 1, scope, updated: now.toISOString(), items });
    if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, error: 'That is too large to sync.' };
    try { writeAtomic(path.join(folder, fileName(scope)), text, 0o600); }
    catch { return { ok: false, error: 'Could not write to that folder.' }; }
  }
  return { ok: true, items, changedLocal, wrote: !same };
}

// ---- settings and wiring
const settingsFile = () => path.join(app.getPath('userData'), 'sync-folder.json');
function readFolder() {
  try {
    const v = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return typeof v.folder === 'string' && v.folder && fs.statSync(v.folder).isDirectory() ? v.folder : null;
  } catch { return null; }
}

let last = null; // { scope, items } from the renderer's latest save

function push(result, scope) {
  if (!result.ok || !result.changedLocal) return;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('sync:merged', { scope, items: result.items });
}

/** Called after the renderer saves its records. Returns the folder state for the page. */
function onRecords(scope, items) {
  last = { scope, items };
  // The sample patient is a demo: it never goes to a shared folder.
  if (scope === 'sample') return null;
  const folder = readFolder();
  if (!folder) return null;
  const r = syncFolder(folder, scope, items);
  push(r, scope);
  return r.ok ? { ok: true } : r;
}

function register() {
  ipcMain.handle('sync:config', async () => ({ ok: true, folder: readFolder() }));
  ipcMain.handle('sync:choose', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a sync folder', message: 'Choose a folder in iCloud Drive so your other devices can read it.', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true, folder: readFolder() };
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      writeAtomic(settingsFile(), JSON.stringify({ folder: r.filePaths[0] }));
    } catch { return { ok: false, error: 'Could not save that choice.' }; }
    const sync = last ? onRecords(last.scope, last.items) : null;
    return { ok: true, folder: r.filePaths[0], ...(sync && !sync.ok ? { error: sync.error } : {}) };
  });
  ipcMain.handle('sync:clear', async () => {
    try { fs.unlinkSync(settingsFile()); } catch { /* already off */ }
    return { ok: true, folder: null };
  });
  app.on('browser-window-focus', () => { if (last) onRecords(last.scope, last.items); });
}

module.exports = { register, onRecords, syncFolder, readFolderFile, readFolderState, fileName };
