// LoopStack desktop: one app, two views. The left sidebar switches between
// the person's own dashboard and the care-team review of what they shared.
// The top bar is the glass control layer: data range, Edit layout, Share. Saved layouts and appearance open from the Edit layout panel.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DATA, PATIENT, PATIENTS, PERIOD, SUGGESTIONS } from './data/current';
import { eligibleForBuild } from './data/suggestions';
import { bridge as nsBridge, loadNightscout } from './data/source';
import { SYNTHETIC } from './data/synthetic';
import { useSuggestionsBadge } from './data/tracked';
import { USABLE_N } from './data/derive';
import { recordTileOpen } from './data/tileOpens';
import { loadPreset, PRESETS, TILES, type KV, type Layout, type PresetId } from './layout/model';
import { isDirty, loadWorkspace, persistWorkspace, resetView, resolvedAppearance, type Appearance, type Workspace } from './layout/saved';
import { LayoutControls } from './layout/LayoutControls';
import { PeriodControl } from './ui/PeriodControl';
import { Onboarding } from './views/Onboarding';
import { unsortedCount, useNotes } from './data/notes';
import { openSetup, shouldOpenOnLaunch, useSetup } from './data/setup';
import { parse, toSearch, type Go, type Route, type View } from './nav';
import { packetParts, useStore, type PacketPart } from './state';
import { Announcer, GlassCta, ICheck, IChanges, INote, ILibrary, ISpark, ISuggest, IDashboard, IEdit, IRefresh, IReview, IShare, Mark, useAnnounce } from './ui/kit';
import { Dashboard } from './views/Dashboard';
// The dashboard is the first paint; every other view loads when it's opened.
const Changes = lazy(() => import('./views/Other').then(m => ({ default: m.Changes })));
const Settings = lazy(() => import('./views/Other').then(m => ({ default: m.Settings })));
const Review = lazy(() => import('./views/Review').then(m => ({ default: m.Review })));
const Notes = lazy(() => import('./views/Notes').then(m => ({ default: m.Notes })));
const Library = lazy(() => import('./views/Library').then(m => ({ default: m.Library })));
const Suggestions = lazy(() => import('./views/Suggestions').then(m => ({ default: m.Suggestions })));
const Assistant = lazy(() => import('./views/Assistant').then(m => ({ default: m.Assistant })));
import { ProfileBar } from './ui/ProfileBar';

const storage = (): KV | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const TITLES: Record<View, string> = {
  dashboard: 'My dashboard',
  review: 'Care-team review',
  changes: 'Changes',
  notes: 'Notes',
  suggestions: 'Suggestions',
  library: 'Feature library',
  assistant: 'Ask & build',
  settings: 'Settings',
};

/** Read the URL once at start: reset, then a preset, then whatever was saved. */
function boot() {
  const b = parse(window.location.search);
  const store = storage();
  let workspace = loadWorkspace(store);
  if (b.reset) workspace = resetView(workspace);
  if (b.preset) workspace = { ...workspace, activeId: null, current: { ...workspace.current, layout: loadPreset(b.preset) } };
  if (b.preset || b.reset) persistWorkspace(store, workspace);
  const explicitHour = new URLSearchParams(window.location.search).has('sel') || new URLSearchParams(window.location.search).has('mode');
  if (!explicitHour) b.route = { ...b.route, ...workspace.current.settings };
  // Drop one-shot params so a reload doesn't re-apply them.
  if (b.preset || b.reset) window.history.replaceState(null, '', `${window.location.pathname}${toSearch(b.route)}`);
  return { route: b.route, workspace };
}

export function App() {
  return (
    <Announcer>
      <Shell />
    </Announcer>
  );
}

function Shell() {
  const [init] = useState(boot);
  const [route, setRoute] = useState<Route>(init.route);
  const [workspace, setWorkspace] = useState<Workspace>(init.workspace);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  // One step of undo for changes that replace the working view: a preset, a reset, a removed tile, a saved-layout switch.
  const [undo, setUndo] = useState<{ label: string; prev: Workspace } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const layout = workspace.current.layout;
  // Saved layouts sit behind Edit layout: leaving edit mode closes them.
  useEffect(() => { if (!route.edit) setLayoutsOpen(false); }, [route.edit]);
  const announce = useAnnounce();
  const routeRef = useRef(route);
  routeRef.current = route;

  const setLayout = useCallback((l: Layout) => {
    setWorkspace(current => ({ ...current, current: { ...current.current, layout: l } }));
  }, []);

  useEffect(() => { setStorageError(!persistWorkspace(storage(), workspace)); }, [workspace]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolvedAppearance(workspace.current.appearance, media.matches);
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [workspace.current.appearance]);
  useEffect(() => {
    setWorkspace(current => current.current.settings.mode === route.mode && current.current.settings.sel === route.sel ? current :
      { ...current, current: { ...current.current, settings: { mode: route.mode, sel: route.sel } } });
  }, [route.mode, route.sel]);

  const go: Go = useCallback((patch, opts) => {
    const next = { ...routeRef.current, ...patch };
    if (patch.view && !patch.evidence) next.evidence = undefined;
    if (next.view !== 'dashboard') { next.edit = false; next.tile = null; }
    if (patch.edit) next.tile = null;
    if (patch.tile) recordTileOpen(patch.tile);
    routeRef.current = next;
    const url = `${window.location.pathname}${toSearch(next)}`;
    if (opts?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setRoute(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = parse(window.location.search).route;
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = `${route.view === 'dashboard' && route.tile ? TILES[route.tile].title : TITLES[route.view]} · LoopStack`;
  }, [route.view, route.tile]);

  /** Remember the workspace as it is now, so the change about to happen can be undone in one step. */
  const checkpoint = (label: string) => setUndo({ label, prev: workspace });
  const onUndo = () => {
    if (!undo) return;
    setWorkspace(undo.prev);
    go(undo.prev.current.settings, { replace: true });
    announce(`Undone: ${undo.label}`);
    setUndo(null);
  };
  // The undo offer belongs to the dashboard; leaving it drops the offer.
  useEffect(() => { if (route.view !== 'dashboard') setUndo(null); }, [route.view]);
  const onPreset = (p: PresetId) => {
    checkpoint(`${PRESETS[p].name} layout loaded.`);
    setWorkspace(current => ({ ...current, activeId: null, current: { ...current.current, layout: loadPreset(p) } }));
    announce(`${PRESETS[p].name} layout loaded. Undo is available.`);
  };
  const onReset = () => {
    checkpoint('Dashboard reset to the default layout.');
    const next = resetView(workspace);
    setWorkspace(next);
    go(next.current.settings, { replace: true });
    announce('Dashboard reset to the default layout. Undo is available.');
  };
  const setAppearance = (a: Appearance) => setWorkspace(current => ({ ...current, current: { ...current.current, appearance: a } }));

  // First run: nothing connected and never closed → the setup stepper opens by itself (and ?setup=1 opens it for a look).
  const setup = useSetup();
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!setup.ready || openedOnce.current) return;
    openedOnce.current = true;
    if (new URLSearchParams(window.location.search).has('setup') || shouldOpenOnLaunch(setup.saved, setup.facts, setup.hasBridge)) openSetup('data');
  }, [setup.ready, setup.saved, setup.facts, setup.hasBridge]);
  const nav: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'dashboard', label: 'My dashboard', icon: <IDashboard /> },
    { id: 'review', label: 'Care-team review', icon: <IReview /> },
    { id: 'changes', label: 'Changes', icon: <IChanges /> },
    { id: 'notes', label: 'Notes', icon: <INote /> },
    { id: 'suggestions', label: 'Suggestions', icon: <ISuggest /> },
    { id: 'library', label: 'Feature library', icon: <ILibrary /> },
    { id: 'assistant', label: 'Ask & build', icon: <ISpark /> },
  ];
  const clinician = route.view === 'review';
  // Notes badge: notes not yet sent anywhere.
  const [allNotes] = useNotes();
  const unsorted = unsortedCount(allNotes);
  // Suggestions badge: new suggestions plus tracked readings that reached confidence.
  const badge = useSuggestionsBadge(SUGGESTIONS.map((s) => ({ id: s.id, ready: eligibleForBuild(s).ok })));

  return (
    <div className={`app${window.loopstack?.desktop ? ' in-electron' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="LoopStack">
        <div className="brand">
          <Mark />
          <span className="wordmark">LoopStack</span>
        </div>
        <nav aria-label="Main">
          <ul>
            {nav.map((n) => (
              <li key={n.id}>
                <button type="button" className="nav-item" title={n.label} aria-current={route.view === n.id ? 'page' : undefined} onClick={() => go({ view: n.id })}>
                  {n.icon}
                  <span className="nav-label">{n.label}</span>
                  {n.id === 'notes' && unsorted > 0 && <><span className="nav-badge" aria-hidden="true">{unsorted > 99 ? '99+' : unsorted}</span><span className="sr-only">, {unsorted} to sort</span></>}
                  {n.id === 'suggestions' && badge.total > 0 && <><span className="nav-badge" aria-hidden="true">{badge.total > 99 ? '99+' : badge.total}</span><span className="sr-only">, {badge.total} new</span></>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <ProfileBar clinician={clinician} go={go} />
      </aside>
      <Onboarding onPreset={onPreset} go={go} />

      <div className="main-col">
        <header className="topbar glass">
          {/* On a tile's detail page the top bar names the tile; the back button carries the way home. */}
          <h1 className="top-title">{route.view === 'dashboard' && route.tile ? TILES[route.tile].title : route.view === 'dashboard' && route.edit ? 'Arrange your dashboard' : TITLES[route.view]}</h1>
          {/* One period for every tile; the care-team review keeps its packet's own period. */}
          {route.view === 'dashboard' && !route.edit && <PeriodControl />}
          {route.view !== 'review' && route.view !== 'dashboard' && <span className="range" aria-label={`Data range ${PERIOD.label}, ${PERIOD.days} days, ${USABLE_N} usable`}>
            <span className="strong">{PERIOD.label}</span> · {PERIOD.days} days, {USABLE_N} usable
          </span>}
          <span className="spacer" />
          {nsBridge() && DATA !== SYNTHETIC && (
            <button
              type="button"
              className={`toggle-btn icon-only${refreshing ? ' busy' : ''}`}
              aria-label="Refresh from Nightscout"
              title="Refresh from Nightscout"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                announce('Refreshing from Nightscout.');
                try { await loadNightscout(); announce('Updated from Nightscout.'); } catch (e) { announce(e instanceof Error ? e.message : 'Could not reach Nightscout.'); }
                setRefreshing(false);
              }}
            >
              <IRefresh />
            </button>
          )}
          {/* Editing: Undo, then Done as the one primary. Otherwise a quiet Edit icon. */}
          {route.view === 'dashboard' && !route.tile && route.edit && (
            <button type="button" className="toggle-btn" disabled={!undo} title={undo ? `Undo: ${undo.label}` : 'Nothing to undo yet'} onClick={onUndo}>Undo</button>
          )}
          {route.view === 'dashboard' && !route.tile && (
            <button
              type="button"
              id="edit-toggle"
              className={route.edit ? 'cta glass-green' : 'toggle-btn icon-only'}
              aria-label={route.edit ? undefined : 'Edit layout'}
              title={route.edit ? undefined : 'Edit layout'}
              onClick={() => { go({ edit: !route.edit }, { replace: true }); announce(route.edit ? 'Finished editing the layout.' : 'Editing the layout. The tile library is open.'); }}
            >
              {route.edit ? <><ICheck /> Done</> : <IEdit />}
            </button>
          )}
          {/* A view's own top-bar actions land here (the care-team review's Save as PDF and Email). */}
          <span id="topbar-actions" className="topbar-actions" />
          {/* Share is the dashboard's primary action; it shows only where the data it shares is on screen. */}
          {((route.view === 'dashboard' && !route.edit) || route.view === 'changes' || route.view === 'suggestions') && <Share go={go} />}
        </header>
        {/* Sample data, said once and kindly, under the bar (not a chip in it). */}
        {DATA.source === 'synthetic' && route.view !== 'settings' && route.view !== 'review' && !route.edit && (
          <p className="sample-note">You’re looking at a made-up patient. <button type="button" className="link-btn" onClick={() => go({ view: 'settings' })}>Connect your Nightscout</button> to see your own days.</p>
        )}
        {layoutsOpen && route.view === 'dashboard' && route.edit && <LayoutControls state={workspace} onChange={(next, undoLabel) => {
          if (undoLabel) checkpoint(undoLabel);
          setWorkspace(next);
          go({ ...next.current.settings, tile: null }, { replace: true });
        }} onReset={onReset} onClose={() => { setLayoutsOpen(false); requestAnimationFrame(() => document.getElementById('lib-saved-row')?.focus()); }} />}
        {undo && route.view === 'dashboard' && !route.edit && (
          <div className="undo-bar" role="group" aria-label="Undo">
            <span className="small">{undo.label}</span>
            <button type="button" className="quiet-btn" onClick={onUndo}>Undo</button>
            <button type="button" className="text-btn" onClick={() => setUndo(null)}>Dismiss</button>
          </div>
        )}
        {storageError && <p className="layout-storage-error" role="alert">Layout storage is unavailable. Changes work now but will not survive a restart. Free browser storage and try again.</p>}
        <main id="main" className="content" tabIndex={-1}>
          {route.view === 'dashboard' && <Dashboard route={route} go={go} layout={layout} setLayout={setLayout} onPreset={onPreset} onReset={onReset} layouts={{ active: workspace.saved.find(v => v.id === workspace.activeId)?.name ?? null, dirty: !!workspace.activeId && isDirty(workspace), count: workspace.saved.length, open: layoutsOpen, onToggle: () => setLayoutsOpen(v => !v), checkpoint }} />}
          <Suspense fallback={<p className="caption view-loading" role="status">Loading…</p>}>
          {route.view === 'review' && <Review route={route} go={go} />}
          {route.view === 'changes' && <Changes />}
          {route.view === 'suggestions' && <Suggestions go={go} />}
          {route.view === 'notes' && <Notes go={go} />}
          {route.view === 'library' && <Library />}
          {route.view === 'assistant' && <Assistant key={route.evidence ? JSON.stringify(route.evidence) : "general"} evidence={route.evidence} />}
          {route.view === 'settings' && <Settings go={go} layout={layout} onReset={onReset} appearance={workspace.current.appearance} onAppearance={setAppearance} />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** "Share with care team" builds a review packet: a snapshot the person picks, never a live feed. */
function Share({ go }: { go: Go }) {
  const { sharePacket, packet } = useStore();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PacketPart[]>(() => packetParts().map((p) => p.id));
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const toggle = (p: PacketPart) => setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  useEffect(() => {
    if (!open) return undefined;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); anchor.current?.querySelector('button')?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open, done]);

  const build = () => {
    sharePacket(parts);
    setDone(true);
    announce(`Packet shared with ${PATIENT.clinician}.`);
  };

  return (
    <div className="menu-wrap" ref={anchor}>
      <GlassCta onClick={() => { setOpen((o) => !o); setDone(false); }} icon={<IShare />} expanded={open} controls="share-panel">Share with care team</GlassCta>
      {/* Portalled out of the glass top bar: glass inside glass can't blur what's behind it (GLASS-1b). */}
      {open && createPortal(
        <div ref={panel} id="share-panel" role="dialog" aria-modal="false" aria-labelledby="share-h" className="popover glass share" style={{ top: pos.top, right: pos.right }}>
          {done ? (
            <>
              <h2 id="share-h" className="h3">Packet shared</h2>
              <p className="small ink">{PATIENT.clinician} can read it now, shared {packet.shared}. It’s a snapshot of {PERIOD.label}; nothing updates on its own.</p>
              <div className="row">
                <button type="button" className="solid-btn" onClick={() => { setOpen(false); go({ view: 'review', patient: PATIENTS[0].id, section: 'glucose' }); }}>See it as your care team does</button>
                <button type="button" className="quiet-btn" onClick={() => setOpen(false)}>Close</button>
              </div>
            </>
          ) : (
            <>
              <h2 id="share-h" className="h3">Build a review packet</h2>
              <p className="small">For {PATIENT.clinician}, before your visit on {PATIENT.nextVisit}. You choose what goes in.</p>
              <ul className="parts">
                <li className="part fixed"><span className="check on" aria-hidden="true" /><span className="stack"><span className="strong">The glucose page</span><span className="caption">Always included: sensor wear, lows, time in range, the curve</span></span></li>
                {packetParts().map((p) => (
                  <li key={p.id}>
                    <label className="part">
                      <input type="checkbox" checked={parts.includes(p.id)} onChange={() => toggle(p.id)} />
                      <span className="stack"><span className="strong">{p.label}</span><span className="caption">{p.note}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button type="button" className="solid-btn" onClick={build}>Share packet</button>
                <button type="button" className="quiet-btn" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              <p className="caption">A packet is a snapshot to read. LoopStack never changes your pump.</p>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

declare global {
  interface Window {
    loopstack?: { desktop: boolean; platform: string; nightscout?: import('./data/source').NightscoutBridge; github?: import('./data/loopBuild').GithubBridge; library?: import('./data/library').LibraryBridge; favorites?: import('./data/favorites').FavoritesBridge; ai?: import('./data/ai').AiBridge; buildNotes?: import('./data/buildNotes').BuildNotesBridge; sync?: import('./data/buildNotes').SyncBridge };
  }
}
