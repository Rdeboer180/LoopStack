// LoopStack desktop: the Electron shell around the Vite + React renderer.
// Security defaults: context isolation on, no Node in the renderer, sandboxed,
// a strict Content-Security-Policy, and no remote content except the Inter
// font from Google Fonts. Nightscout is read here in the main process
// (nightscout.cjs), and the person's Loop build on GitHub (github.cjs), never
// from the page. Navigation away from the app and new windows are
// refused; external links open in the person's browser.
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');
const nightscout = require('./nightscout.cjs');
const github = require('./github.cjs');
const library = require('./library.cjs');
const personal = require('./personal.cjs');
const review = require('./review.cjs');
const proposals = require('./proposals.cjs');
const favorites = require('./favorites.cjs');
const ai = require('./ai.cjs');
const buildnotes = require('./buildnotes.cjs');
const foldersync = require('./foldersync.cjs');

const DEV_URL = process.env.LOOPSTACK_DEV_URL; // e.g. http://localhost:5190
const isDev = Boolean(DEV_URL);

app.setName('LoopStack');

const CSP = [
  "default-src 'self'",
  `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws://localhost:5190 http://localhost:5190' : ''}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function createWindow() {
  const win = new BrowserWindow({
    title: 'LoopStack',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#F6F7F8', // matches --surface-1 so the first paint isn't white
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => win.show());
  // Keep the window title as the app name, not the page's.
  win.on('page-title-updated', (e) => e.preventDefault());

  // No navigation away from the app; links open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      e.preventDefault();
      if (/^(https:\/\/|mailto:)/.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https:\/\/|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  nightscout.register();
  github.register();
  library.register();
  personal.register();
  favorites.register();
  ai.register();
  review.register();
  proposals.register();
  buildnotes.register(foldersync.onRecords);
  foldersync.register();
  // No camera, microphone, location or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // Dev runs use Electron's own bundle, so set the Dock icon here; the packaged
  // app gets it from build/icon.png via electron-builder.
  if (isDev && process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
