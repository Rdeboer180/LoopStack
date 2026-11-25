import { defaultLayout, load, parse, type KV, type Layout } from './model';

export type Appearance = 'light' | 'dark' | 'system';
export interface WidgetSettings { mode: 'hours' | 'blocks'; sel: number }
export interface ViewSnapshot { layout: Layout; appearance: Appearance; settings: WidgetSettings }
export interface SavedView extends ViewSnapshot { id: string; name: string }
export interface Workspace { version: 1; current: ViewSnapshot; activeId: string | null; saved: SavedView[] }
export const VIEW_KEY = 'loopstack.desktop.views.v1';
export const DEFAULT_SETTINGS: WidgetSettings = { mode: 'hours', sel: 7 };
export const isAppearance = (v: unknown): v is Appearance => v === 'light' || v === 'dark' || v === 'system';
export const resolvedAppearance = (v: Appearance, systemDark: boolean) => v === 'system' ? systemDark ? 'dark' : 'light' : v;

/** Whitelist display-only values. Never copy an app store, patient or source configuration. */
export function snapshot(v: unknown, fallback = defaultLayout()): ViewSnapshot {
  const x = v && typeof v === 'object' ? v as Partial<ViewSnapshot> : {};
  const mode = x.settings?.mode === 'blocks' ? 'blocks' : 'hours';
  const sel = x.settings?.sel;
  return {
    layout: x.layout ? parse(JSON.stringify(x.layout)) : parse(JSON.stringify(fallback)),
    appearance: isAppearance(x.appearance) ? x.appearance : 'system',
    settings: { mode, sel: typeof sel === 'number' && Number.isInteger(sel) && sel >= 0 && sel <= (mode === 'blocks' ? 7 : 23) ? sel : mode === 'blocks' ? 2 : 7 },
  };
}

function upgradeEveryday(state: Workspace): Workspace {
  const layout = state.current.layout;
  if (state.activeId || layout.preset !== 'everyday' || layout.tiles.some(t => t.id === 'hour-evidence')) return state;
  return { ...state, current: { ...state.current, layout: defaultLayout() } };
}

export function loadWorkspace(store: KV | null): Workspace {
  const fallback = upgradeEveryday({ version: 1, current: snapshot(null, load(store)), activeId: null, saved: [] });
  try {
    const value = JSON.parse(store?.getItem(VIEW_KEY) ?? 'null');
    if (value?.version !== 1 || !Array.isArray(value.saved)) return fallback;
    const seen = new Set<string>();
    const saved: SavedView[] = [];
    for (const row of value.saved) {
      if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id) || typeof row.name !== 'string' || !row.name.trim()) continue;
      seen.add(row.id);
      saved.push({ id: row.id, name: row.name.trim().slice(0, 60), ...snapshot(row) });
    }
    return upgradeEveryday({ version: 1, current: snapshot(value.current, fallback.current.layout), activeId: saved.some(v => v.id === value.activeId) ? value.activeId : null, saved });
  } catch { return fallback; }
}

export function persistWorkspace(store: KV | null, state: Workspace): boolean {
  try {
    if (!store) return false;
    // Rebuild every record through the whitelist, even when called outside the UI.
    store.setItem(VIEW_KEY, JSON.stringify({ version: 1, current: snapshot(state.current), activeId: state.activeId,
      saved: state.saved.map(v => ({ id: v.id, name: v.name, ...snapshot(v) })) }));
    return true;
  } catch { return false; }
}

const validName = (state: Workspace, name: string, except?: string) => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new Error('Use a layout name between 1 and 60 characters.');
  if (state.saved.some(v => v.id !== except && v.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('That layout name is already in use. Choose another name.');
  return trimmed;
};
export function saveNewView(state: Workspace, name: string, id: string): Workspace {
  if (!id || state.saved.some(v => v.id === id)) throw new Error('Could not create a unique layout. Try again.');
  const view = { id, name: validName(state, name), ...snapshot(state.current) };
  return { ...state, activeId: id, saved: [...state.saved, view] };
}
export function applyView(state: Workspace, id: string): Workspace {
  const view = state.saved.find(v => v.id === id);
  return view ? { ...state, activeId: id, current: snapshot(view) } : state;
}
export const updateView = (state: Workspace): Workspace => ({ ...state,
  saved: state.saved.map(v => v.id === state.activeId ? { id: v.id, name: v.name, ...snapshot(state.current) } : v) });
export function renameView(state: Workspace, id: string, name: string): Workspace {
  const nextName = validName(state, name, id);
  return { ...state, saved: state.saved.map(v => v.id === id ? { ...v, name: nextName } : v) };
}
/** Deleting a snapshot leaves the current dashboard intact as an unsaved working view. */
export const deleteView = (state: Workspace, id: string): Workspace => ({ ...state, activeId: state.activeId === id ? null : state.activeId, saved: state.saved.filter(v => v.id !== id) });
export const resetView = (state: Workspace): Workspace => ({ ...state, activeId: null, current: snapshot(null) });
export const isDirty = (state: Workspace) => {
  const view = state.saved.find(v => v.id === state.activeId);
  return !view || JSON.stringify(snapshot(view)) !== JSON.stringify(snapshot(state.current));
};
