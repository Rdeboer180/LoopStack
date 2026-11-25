// The dashboard layout model: a 12-column grid of tiles, in reading order.
// Pure functions only, so every move the pointer makes and every move the
// keyboard makes go through the same code, and the tests cover both.
//
// PROD-1: the person's dashboard is customizable (this file). The care-team
// review is fixed and never reads this.
// PROD-2: the daily trend heads-ups and the day tracker are on every
// dashboard. They can be moved and resized, never removed.

export const COLUMNS = 12;
/** Column spans a tile can take: S, M, L, full width. */
export const WIDTHS = [4, 6, 8, 12] as const;
export type Width = (typeof WIDTHS)[number];
export const WIDTH_NAME: Record<Width, string> = { 4: 'S', 6: 'M', 8: 'L', 12: 'Full' };
/** Height in grid rows. */
export const MIN_H = 1;
export const MAX_H = 4;

export type TileKind =
  | 'glucose-now'
  | 'heads-ups'
  | 'hour-evidence'
  | 'review-queue'
  | 'day-tracker'
  | 'what-loop-did'
  | 'before-after'
  | 'time-in-range'
  | 'device-life'
  | 'care-thread'
  | 'meals'
  | 'daily-glucose'
  | 'hour-by-hour'
  | 'key-numbers';

export interface TileSpec {
  kind: TileKind;
  title: string;
  /** One line for the library panel. */
  blurb: string;
  w: Width;
  h: number;
  minW: Width;
  minH: number;
  /** PROD-2: on every dashboard, never removable. */
  pinned?: boolean;
}

export const TILES: Record<TileKind, TileSpec> = {
  'hour-evidence': { kind: 'hour-evidence', title: 'Weekday by hour', blurb: 'Inspect glucose readings and dates behind each hour', w: 8, h: 3, minW: 6, minH: 3 },
  'review-queue': { kind: 'review-queue', title: 'Your review queue', blurb: 'Open observations, meal comparisons and staged drafts', w: 4, h: 3, minW: 4, minH: 3 },
  'glucose-now': { kind: 'glucose-now', title: 'Glucose now', blurb: 'CGM reading, trend, Loop status, active insulin and carbs', w: 4, h: 2, minW: 4, minH: 2 },
  'heads-ups': { kind: 'heads-ups', title: 'Daily trend heads-ups', blurb: 'Weekday stretches that often run low or high', w: 4, h: 2, minW: 4, minH: 2, pinned: true },
  'day-tracker': { kind: 'day-tracker', title: 'Day tracker', blurb: 'Glucose, insulin, carbs and exercise by hour for a weekday', w: 8, h: 3, minW: 6, minH: 2, pinned: true },
  'what-loop-did': { kind: 'what-loop-did', title: 'What Loop did', blurb: 'Delivered against scheduled, 14 days by 24 hours', w: 8, h: 3, minW: 6, minH: 2 },
  'before-after': { kind: 'before-after', title: 'Before and after', blurb: 'Lunch, before and after your latest settings change', w: 6, h: 2, minW: 4, minH: 2 },
  'time-in-range': { kind: 'time-in-range', title: 'Time in range', blurb: 'Five bands, 14 days', w: 4, h: 2, minW: 4, minH: 2 },
  'device-life': { kind: 'device-life', title: 'Device life', blurb: 'Pod age, sensor day, Loop build expiry', w: 4, h: 1, minW: 4, minH: 1 },
  'care-thread': { kind: 'care-thread', title: 'Care-team thread', blurb: 'Messages with your care team', w: 4, h: 2, minW: 4, minH: 2 },
  meals: { kind: 'meals', title: 'Favorite foods', blurb: 'Every time you had each favorite: how it went, absorption entered against observed', w: 8, h: 3, minW: 6, minH: 2 },
  'hour-by-hour': { kind: 'hour-by-hour', title: 'Hour by hour', blurb: 'Each hour of the day across the period: median, and how often it ran low or high', w: 8, h: 2, minW: 6, minH: 2 },
  'key-numbers': { kind: 'key-numbers', title: 'Key numbers', blurb: 'Average glucose, GMI and variability for the period', w: 4, h: 2, minW: 4, minH: 2 },
  'daily-glucose': { kind: 'daily-glucose', title: 'Daily glucose', blurb: 'Your average glucose each day, with its spread, and today so far', w: 8, h: 2, minW: 4, minH: 2 },
};

export const ALL_KINDS = Object.keys(TILES) as TileKind[];
export const PINNED: readonly TileKind[] = ALL_KINDS.filter((k) => TILES[k].pinned);

export interface Tile {
  /** One tile per kind, so the kind is the id. */
  id: TileKind;
  w: Width;
  h: number;
}

export interface Layout {
  version: 1;
  preset: PresetId | 'custom';
  tiles: Tile[];
}

// ------------------------------------------------------------ presets

export type PresetId = 'everyday' | 'before-visit' | 'overnight';

export const PRESETS: Record<PresetId, { name: string; blurb: string; tiles: [TileKind, Width?, number?][] }> = {
  everyday: {
    name: 'Everyday',
    blurb: 'Glucose now first, then today’s heads-ups and your weekday',
    tiles: [
      ['glucose-now', 6, 2],
      ['heads-ups', 6, 2],
      ['hour-evidence', 8, 3],
      ['review-queue', 4, 3],
      ['day-tracker', 8, 3],
      ['device-life', 4, 1],
      ['care-thread', 4, 2],
      ['time-in-range', 4, 3],
      ['meals', 8, 3],
      ['what-loop-did', 12, 3],
    ],
  },
  'before-visit': {
    name: 'Before a visit',
    blurb: 'What you’ll talk about: the change, what Loop did, the thread',
    tiles: [
      ['heads-ups', 4, 2],
      ['before-after', 8, 2],
      ['what-loop-did', 8, 3],
      ['care-thread', 4, 3],
      ['day-tracker', 8, 3],
      ['time-in-range', 4, 2],
      ['glucose-now', 4, 2],
    ],
  },
  overnight: {
    name: 'Overnight',
    blurb: 'Night first: what Loop did, glucose now, device life',
    tiles: [
      ['what-loop-did', 8, 3],
      ['glucose-now', 4, 2],
      ['device-life', 4, 1],
      ['day-tracker', 8, 3],
      ['heads-ups', 4, 2],
      ['time-in-range', 4, 1],
    ],
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
export const DEFAULT_PRESET: PresetId = 'everyday';

const tileOf = (kind: TileKind, w?: number, h?: number): Tile => {
  const s = TILES[kind];
  return { id: kind, w: clampW(kind, w ?? s.w), h: clampH(kind, h ?? s.h) };
};

/** Pinned tiles a list is missing, appended at their default size (PROD-2). */
function withPinned(tiles: Tile[]): Tile[] {
  const out = [...tiles];
  for (const k of PINNED) if (!out.some((t) => t.id === k)) out.push(tileOf(k));
  return out;
}

export function loadPreset(id: PresetId): Layout {
  return { version: 1, preset: id, tiles: withPinned(PRESETS[id].tiles.map(([k, w, h]) => tileOf(k, w, h))) };
}

export const defaultLayout = (): Layout => loadPreset(DEFAULT_PRESET);

// ------------------------------------------------------------ clamps

export function clampW(kind: TileKind, w: number): Width {
  const min = TILES[kind].minW;
  const allowed = WIDTHS.filter((x) => x >= min);
  // The nearest allowed span, never past 12 columns or under the tile's minimum.
  const target = Math.min(Math.max(w, min), COLUMNS);
  return allowed.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best), allowed[0]);
}

export function clampH(kind: TileKind, h: number): number {
  return Math.min(MAX_H, Math.max(TILES[kind].minH, Math.max(MIN_H, Math.round(h))));
}

// ------------------------------------------------------------ edits

const edited = (l: Layout, tiles: Tile[]): Layout => ({ ...l, preset: 'custom', tiles });
export const indexOf = (l: Layout, id: TileKind) => l.tiles.findIndex((t) => t.id === id);
export const has = (l: Layout, id: TileKind) => indexOf(l, id) >= 0;

/** Move a tile to a position in reading order (clamped to the ends). */
export function moveTo(l: Layout, id: TileKind, to: number): Layout {
  const from = indexOf(l, id);
  if (from < 0) return l;
  const dest = Math.max(0, Math.min(l.tiles.length - 1, to));
  if (dest === from) return l;
  const tiles = [...l.tiles];
  const [t] = tiles.splice(from, 1);
  tiles.splice(dest, 0, t);
  return edited(l, tiles);
}

export const moveBy = (l: Layout, id: TileKind, delta: number) => moveTo(l, id, indexOf(l, id) + delta);

export function resize(l: Layout, id: TileKind, size: { w?: number; h?: number }): Layout {
  const i = indexOf(l, id);
  if (i < 0) return l;
  const cur = l.tiles[i];
  const next: Tile = { id, w: size.w == null ? cur.w : clampW(id, size.w), h: size.h == null ? cur.h : clampH(id, size.h) };
  if (next.w === cur.w && next.h === cur.h) return l;
  const tiles = [...l.tiles];
  tiles[i] = next;
  return edited(l, tiles);
}

/** One width step wider or narrower: S → M → L → Full. */
export function stepWidth(l: Layout, id: TileKind, dir: 1 | -1): Layout {
  const t = l.tiles[indexOf(l, id)];
  if (!t) return l;
  const steps = WIDTHS.filter((x) => x >= TILES[id].minW);
  const k = steps.indexOf(t.w);
  const next = steps[Math.max(0, Math.min(steps.length - 1, k + dir))];
  return resize(l, id, { w: next });
}

export function stepHeight(l: Layout, id: TileKind, dir: 1 | -1): Layout {
  const t = l.tiles[indexOf(l, id)];
  return t ? resize(l, id, { h: t.h + dir }) : l;
}

export function add(l: Layout, kind: TileKind, at = l.tiles.length): Layout {
  if (has(l, kind)) return l;
  const tiles = [...l.tiles];
  tiles.splice(Math.max(0, Math.min(at, tiles.length)), 0, tileOf(kind));
  return edited(l, tiles);
}

export const canRemove = (kind: TileKind) => !TILES[kind].pinned;

/** Remove a tile. Pinned tiles (PROD-2) stay: removing one does nothing. */
export function remove(l: Layout, id: TileKind): Layout {
  if (!canRemove(id) || !has(l, id)) return l;
  return edited(l, l.tiles.filter((t) => t.id !== id));
}

/** Tiles the library can still add. */
export const available = (l: Layout): TileKind[] => ALL_KINDS.filter((k) => !has(l, k));

// ------------------------------------------------------------ keyboard

export interface KeyResult {
  layout: Layout;
  /** What changed, for the aria-live region; null when nothing did. */
  message: string | null;
}

export function describe(l: Layout, id: TileKind): string {
  const i = indexOf(l, id);
  const t = l.tiles[i];
  return `${TILES[id].title}: position ${i + 1} of ${l.tiles.length}, ${WIDTH_NAME[t.w]} width, ${t.h} ${t.h === 1 ? 'row' : 'rows'} high`;
}

/**
 * Arrow keys on a focused tile in edit mode. Left/Up move it earlier,
 * Right/Down move it later; with Shift, Left/Right make it narrower/wider
 * and Up/Down shorter/taller. Delete or Backspace removes it, unless pinned.
 */
export function applyKey(l: Layout, id: TileKind, key: string, shift = false): KeyResult {
  let next = l;
  if (shift) {
    if (key === 'ArrowLeft') next = stepWidth(l, id, -1);
    else if (key === 'ArrowRight') next = stepWidth(l, id, 1);
    else if (key === 'ArrowUp') next = stepHeight(l, id, -1);
    else if (key === 'ArrowDown') next = stepHeight(l, id, 1);
  } else if (key === 'ArrowLeft' || key === 'ArrowUp') next = moveBy(l, id, -1);
  else if (key === 'ArrowRight' || key === 'ArrowDown') next = moveBy(l, id, 1);
  else if (key === 'Delete' || key === 'Backspace') {
    if (!canRemove(id)) return { layout: l, message: `${TILES[id].title} is always on your dashboard. You can move or resize it.` };
    next = remove(l, id);
    return { layout: next, message: next === l ? null : `${TILES[id].title} removed. Add it back from the library.` };
  }
  if (next === l) return { layout: l, message: null };
  return { layout: next, message: describe(next, id) };
}

// ------------------------------------------------------------ persistence

export const STORAGE_KEY = 'loopstack.desktop.layout.v1';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const serialize = (l: Layout) => JSON.stringify(l);

/** Parse a saved layout; anything unknown or malformed falls back to the default. */
export function parse(raw: string | null): Layout {
  if (!raw) return defaultLayout();
  try {
    const v = JSON.parse(raw) as Partial<Layout>;
    if (v.version !== 1 || !Array.isArray(v.tiles)) return defaultLayout();
    const seen = new Set<TileKind>();
    const tiles: Tile[] = [];
    for (const t of v.tiles) {
      if (!t || !Object.hasOwn(TILES, t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      tiles.push(tileOf(t.id, Number(t.w) || undefined, Number(t.h) || undefined));
    }
    const preset = v.preset && (v.preset === 'custom' || Object.hasOwn(PRESETS, v.preset)) ? v.preset : 'custom';
    return { version: 1, preset, tiles: withPinned(tiles) };
  } catch {
    return defaultLayout();
  }
}

export function save(store: KV | null, l: Layout): void {
  try {
    store?.setItem(STORAGE_KEY, serialize(l));
  } catch {
    // Storage can be full or blocked; the layout still works for this session.
  }
}

export function load(store: KV | null): Layout {
  try {
    return parse(store?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return defaultLayout();
  }
}

export function clear(store: KV | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing saved to clear.
  }
}
