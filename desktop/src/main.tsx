import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state';
import { onDatasetChange } from './data/current';
import { boot } from './data/source';
import { bootLoopBuild } from './data/loopBuild';
import { bootBuildNotes } from './data/buildNotes';
import { scheduleOnMac } from './data/notify';
import { loadWorkspace, resolvedAppearance } from './layout/saved';
// Tokens come from the LoopStack system, not a copy (COL-1).
import '../../src/styles/tokens.css';
import './styles/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

// Apply the saved appearance before any data connector can delay first paint.
try {
  const preference = loadWorkspace(window.localStorage).current.appearance;
  const theme = resolvedAppearance(preference, window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch { /* The shell still offers session-only appearance when storage is blocked. */ }

/** Remounts the app when the dataset changes, so every view and the shared thread start from the new data. */
function Root() {
  const [version, setVersion] = useState(0);
  useEffect(() => onDatasetChange(() => setVersion((v) => v + 1)), []);
  return (
    <StoreProvider key={version}>
      <App />
    </StoreProvider>
  );
}

// Read Nightscout first when connected, so the first paint is the person's own
// data rather than the sample patient's under the person's name.
if (window.loopstack?.nightscout) rootEl.innerHTML = '<p class="boot-note">Reading your Nightscout…</p>';
void bootLoopBuild().catch(() => undefined);
bootBuildNotes();
// Heads-ups queue while the app is open, rebuilt each time the data is read again (and every 6 hours, so weekly ones come round again).
scheduleOnMac();
onDatasetChange(() => { scheduleOnMac(); });
window.setInterval(() => { scheduleOnMac(); }, 6 * 3_600_000);
void boot().then((error) => {
  if (error) {
    try { window.sessionStorage.setItem('loopstack.ns.error', error); } catch { /* Rendering must not depend on browser storage. */ }
  }
  createRoot(rootEl).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
