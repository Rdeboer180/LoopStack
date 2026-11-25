import { describe, expect, it } from 'vitest';
import {
  add, applyKey, available, clampW, COLUMNS, defaultLayout, indexOf, load, loadPreset, moveBy, moveTo, parse, PINNED,
  PRESET_IDS, remove, resize, save, serialize, stepHeight, stepWidth, STORAGE_KEY, TILES, type KV, type TileKind,
} from './model';

const ids = (l: { tiles: { id: TileKind }[] }) => l.tiles.map((t) => t.id);

function memory(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('reorder', () => {
  it('moves a tile to a new position and keeps the rest in order', () => {
    const l = defaultLayout();
    const moved = moveTo(l, 'what-loop-did', 0);
    expect(ids(moved)[0]).toBe('what-loop-did');
    expect(ids(moved).slice(1)).toEqual(ids(l).filter((k) => k !== 'what-loop-did'));
    expect(moved.preset).toBe('custom');
  });
  it('clamps at both ends and returns the same layout when nothing moves', () => {
    const l = defaultLayout();
    const first = l.tiles[0].id;
    expect(moveBy(l, first, -1)).toBe(l);
    expect(ids(moveTo(l, first, 99)).at(-1)).toBe(first);
  });
});

describe('resize', () => {
  it('clamps width to 12 columns and to the tile minimum', () => {
    const l = defaultLayout();
    expect(resize(l, 'glucose-now', { w: 40 }).tiles[indexOf(l, 'glucose-now')].w).toBe(COLUMNS);
    expect(resize(l, 'what-loop-did', { w: 1 }).tiles[indexOf(l, 'what-loop-did')].w).toBe(TILES['what-loop-did'].minW);
    expect(clampW('device-life', 7)).toBe(6);
    for (const t of resize(l, 'day-tracker', { w: 13 }).tiles) expect(t.w).toBeLessThanOrEqual(COLUMNS);
  });
  it('steps S → M → L → Full and stops at the ends', () => {
    let l = defaultLayout();
    l = resize(l, 'device-life', { w: 4 });
    l = stepWidth(l, 'device-life', 1);
    expect(l.tiles[indexOf(l, 'device-life')].w).toBe(6);
    l = stepWidth(stepWidth(stepWidth(l, 'device-life', 1), 'device-life', 1), 'device-life', 1);
    expect(l.tiles[indexOf(l, 'device-life')].w).toBe(12);
    l = stepHeight(stepHeight(stepHeight(stepHeight(l, 'device-life', 1), 'device-life', 1), 'device-life', 1), 'device-life', 1);
    expect(l.tiles[indexOf(l, 'device-life')].h).toBe(4);
  });
});

describe('add and remove', () => {
  it('adds a tile from the library once', () => {
    const l = defaultLayout();
    expect(available(l)).toContain('before-after');
    const added = add(l, 'before-after');
    expect(ids(added).at(-1)).toBe('before-after');
    expect(add(added, 'before-after')).toBe(added);
    expect(available(added)).not.toContain('before-after');
  });
  it('removes a tile', () => {
    const l = defaultLayout();
    const r = remove(l, 'device-life');
    expect(ids(r)).not.toContain('device-life');
    expect(r.tiles).toHaveLength(l.tiles.length - 1);
  });
});

describe('PROD-2: heads-ups and the day tracker are always on', () => {
  it('removing either one does nothing', () => {
    const l = defaultLayout();
    for (const k of ['heads-ups', 'day-tracker'] as const) {
      expect(remove(l, k)).toBe(l);
      expect(applyKey(l, k, 'Delete').layout).toBe(l);
    }
    expect(PINNED).toEqual(['heads-ups', 'day-tracker']);
  });
  it('every preset includes both', () => {
    for (const p of PRESET_IDS) {
      const l = loadPreset(p);
      expect(ids(l)).toContain('heads-ups');
      expect(ids(l)).toContain('day-tracker');
    }
  });
  it('a saved layout missing one gets it back', () => {
    const l = parse(JSON.stringify({ version: 1, preset: 'custom', tiles: [{ id: 'glucose-now', w: 4, h: 2 }] }));
    expect(ids(l)).toEqual(['glucose-now', 'heads-ups', 'day-tracker']);
  });
});

describe('presets', () => {
  it('loads each preset with its own order and name', () => {
    expect(ids(loadPreset('everyday'))[0]).toBe('glucose-now');
    expect(ids(loadPreset('before-visit'))).toContain('before-after');
    expect(ids(loadPreset('overnight'))[0]).toBe('what-loop-did');
    expect(loadPreset('overnight').preset).toBe('overnight');
  });
  it('fits every preset tile inside 12 columns', () => {
    for (const p of PRESET_IDS) for (const t of loadPreset(p).tiles) expect(t.w).toBeLessThanOrEqual(COLUMNS);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const store = memory();
    const l = resize(moveTo(add(defaultLayout(), 'before-after'), 'before-after', 1), 'before-after', { w: 12, h: 3 });
    save(store, l);
    expect(store.data.has(STORAGE_KEY)).toBe(true);
    expect(load(store)).toEqual(l);
    expect(serialize(load(store))).toBe(serialize(l));
  });
  it('falls back to the default for nothing saved or a broken value', () => {
    expect(load(memory())).toEqual(defaultLayout());
    expect(parse('{nope')).toEqual(defaultLayout());
    expect(parse(JSON.stringify({ version: 2, tiles: [] }))).toEqual(defaultLayout());
  });
  it('drops unknown and duplicate tiles', () => {
    const l = parse(JSON.stringify({ version: 1, preset: 'custom', tiles: [{ id: 'nope', w: 4, h: 1 }, { id: 'heads-ups', w: 4, h: 1 }, { id: 'heads-ups', w: 8, h: 1 }, { id: 'day-tracker', w: 99, h: 9 }] }));
    expect(ids(l)).toEqual(['heads-ups', 'day-tracker']);
    expect(l.tiles[1]).toEqual({ id: 'day-tracker', w: 12, h: 4 });
  });
});

describe('keyboard', () => {
  it('moves with arrows and announces the new position', () => {
    const l = defaultLayout();
    const second = l.tiles[1].id;
    const r = applyKey(l, second, 'ArrowLeft');
    expect(ids(r.layout)[0]).toBe(second);
    expect(r.message).toMatch(/position 1 of/);
    const back = applyKey(r.layout, second, 'ArrowDown');
    expect(ids(back.layout)).toEqual(ids(l));
  });
  it('resizes with Shift and arrows', () => {
    const l = defaultLayout();
    const r = applyKey(resize(l, 'glucose-now', { w: 4 }), 'glucose-now', 'ArrowRight', true);
    expect(r.layout.tiles[indexOf(r.layout, 'glucose-now')].w).toBe(6);
    expect(r.message).toMatch(/M width/);
    const t = applyKey(r.layout, 'glucose-now', 'ArrowDown', true);
    expect(t.layout.tiles[indexOf(t.layout, 'glucose-now')].h).toBe(3);
  });
  it('says nothing when a key changes nothing', () => {
    const l = defaultLayout();
    expect(applyKey(l, l.tiles[0].id, 'ArrowUp')).toEqual({ layout: l, message: null });
    expect(applyKey(l, 'heads-ups', 'Delete').message).toMatch(/always on your dashboard/);
  });
});
