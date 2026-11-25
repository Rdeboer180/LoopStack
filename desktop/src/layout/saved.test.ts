import { describe, expect, it } from 'vitest';
import { defaultLayout, moveTo, remove, resize, save, type KV } from './model';
import { applyView, deleteView, isDirty, loadWorkspace, persistWorkspace, renameView, resetView, resolvedAppearance, saveNewView, snapshot, updateView, VIEW_KEY } from './saved';

const memory = (): KV => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
describe('saved dashboard views', () => {
  it('updates the unsaved Everyday preset while preserving a named snapshot of the older layout', () => {
    const store = memory();
    const older = loadWorkspace(null);
    older.current.layout.tiles = older.current.layout.tiles.filter(t => t.id !== 'hour-evidence' && t.id !== 'review-queue');
    const named = saveNewView(older, 'Original', 'original');
    persistWorkspace(store, named);
    expect(loadWorkspace(store)).toEqual(named);
    persistWorkspace(store, { ...named, activeId: null });
    const updated = loadWorkspace(store);
    expect(updated.current.layout).toEqual(defaultLayout());
    expect(updated.saved).toEqual(named.saved);
  });
  it('migrates the existing layout without losing order, size or visibility', () => {
    const store = memory();
    const layout = resize(moveTo(remove(defaultLayout(), 'device-life'), 'meals', 0), 'meals', { w: 12, h: 4 });
    save(store, layout);
    expect(loadWorkspace(store).current.layout).toEqual(layout);
    expect(loadWorkspace(store).current.appearance).toBe('system');
  });
  it('saves more than two layouts, switches and restores the working view on relaunch', () => {
    const store = memory();
    let state = saveNewView(loadWorkspace(store), 'Day', 'day');
    state.current = { layout: resize(state.current.layout, 'day-tracker', { w: 12 }), appearance: 'dark', settings: { mode: 'blocks', sel: 4 } };
    state = saveNewView(state, 'Night', 'night');
    state = saveNewView(state, 'Visit', 'visit');
    expect(state.saved).toHaveLength(3);
    state = applyView(state, 'day');
    expect(state.current.appearance).toBe('system');
    state = applyView(state, 'night');
    expect(state.current.appearance).toBe('dark');
    expect(state.current.settings).toEqual({ mode: 'blocks', sel: 4 });
    expect(persistWorkspace(store, state)).toBe(true);
    expect(loadWorkspace(store)).toEqual(state);
  });
  it('keeps edits separate until update, supports rename and leaves widgets after deletion', () => {
    let state = saveNewView(loadWorkspace(null), 'Home', 'home');
    state = { ...state, current: { ...state.current, appearance: 'dark' } };
    expect(isDirty(state)).toBe(true);
    expect(state.saved[0].appearance).toBe('system');
    state = updateView(state);
    expect(isDirty(state)).toBe(false);
    state = renameView(state, 'home', 'Evening');
    expect(state.saved[0].name).toBe('Evening');
    const current = state.current;
    state = deleteView(state, 'home');
    expect(state.activeId).toBeNull();
    expect(state.current).toEqual(current);
    expect(state.saved).toEqual([]);
  });
  it('reset leaves named layouts intact and selects the default working view', () => {
    const state = saveNewView(loadWorkspace(null), 'Personal', 'a');
    const reset = resetView(state);
    expect(reset.saved).toEqual(state.saved);
    expect(reset.activeId).toBeNull();
    expect(reset.current).toEqual(snapshot(null));
  });
  it('skips retired widgets and malformed records, restores pinned widgets', () => {
    const store = memory();
    store.setItem(VIEW_KEY, JSON.stringify({ version: 1, activeId: 'old', current: { layout: { version: 1, tiles: [{ id: 'retired' }, { id: 'constructor' }, { id: 'device-life', w: 6, h: 2 }] } }, saved: [null, { id: 'old', name: 'Older view', layout: { version: 1, tiles: [{ id: 'retired' }] } }] }));
    const state = loadWorkspace(store);
    expect(state.current.layout.tiles.map(t => t.id)).toEqual(['device-life', 'heads-ups', 'day-tracker']);
    expect(state.saved[0].layout.tiles.map(t => t.id)).toEqual(['heads-ups', 'day-tracker']);
    store.setItem(VIEW_KEY, '{broken');
    expect(loadWorkspace(store)).toEqual(loadWorkspace(null));
  });
  it('only persists whitelisted display preferences', () => {
    const store = memory();
    const state = loadWorkspace(null);
    const unsafe = { ...state.current, token: 'secret', glucose: [123], therapy: { basal: 1 }, settings: { mode: 'hours', sel: 3, patient: 'private' } };
    persistWorkspace(store, { ...state, current: unsafe as typeof state.current });
    const raw = store.getItem(VIEW_KEY)!;
    for (const forbidden of ['token', 'glucose', 'therapy', 'basal', 'patient']) expect(raw).not.toContain(`"${forbidden}":`);
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('private');
  });
  it('validates names and cannot overwrite an existing view implicitly', () => {
    const state = saveNewView(loadWorkspace(null), 'Home', 'a');
    expect(() => saveNewView(state, ' home ', 'b')).toThrow(/already/);
    expect(() => saveNewView(state, '', 'b')).toThrow(/name/);
    expect(() => saveNewView(state, 'x'.repeat(61), 'b')).toThrow();
    expect(applyView(state, 'missing')).toBe(state);
  });
  it('reports unavailable storage and resolves explicit/system appearance', () => {
    expect(persistWorkspace(null, loadWorkspace(null))).toBe(false);
    const full = memory(); full.setItem = () => { throw Error('QuotaExceeded'); };
    expect(persistWorkspace(full, loadWorkspace(null))).toBe(false);
    expect(resolvedAppearance('system', true)).toBe('dark');
    expect(resolvedAppearance('system', false)).toBe('light');
    expect(resolvedAppearance('light', true)).toBe('light');
    expect(resolvedAppearance('dark', false)).toBe('dark');
  });
});
