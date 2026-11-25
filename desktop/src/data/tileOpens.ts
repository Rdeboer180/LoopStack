// Which tiles the person actually opens, kept on this Mac only (a display preference, no health data).
// Used to show "opened most" in the tile library, so arranging can follow real use rather than guesses.
import type { TileKind } from '../layout/model';

const KEY = 'loopstack.tileOpens.v1';
const DAY = 86_400_000;
const WINDOW_DAYS = 30;

type Opens = Partial<Record<TileKind, number[]>>;

function read(): Opens {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v as Opens : {}; } catch { return {}; }
}

/** Record one open of a tile's detail page; entries older than 30 days are dropped. */
export function recordTileOpen(kind: TileKind, now = Date.now()) {
  const all = read();
  const keep = (xs: unknown) => (Array.isArray(xs) ? xs.filter((t): t is number => typeof t === 'number' && now - t < WINDOW_DAYS * DAY) : []);
  const next: Opens = {};
  for (const [k, v] of Object.entries(all)) { const kept = keep(v); if (kept.length) next[k as TileKind] = kept; }
  next[kind] = [...keep(all[kind]), now].slice(-200);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
}

/** Tiles opened in the last 30 days, most first. Pure over the stored record and `now`. */
export function mostOpened(now = Date.now(), opens: Opens = read()): { kind: TileKind; n: number }[] {
  return Object.entries(opens)
    .map(([kind, xs]) => ({ kind: kind as TileKind, n: (Array.isArray(xs) ? xs : []).filter((t) => typeof t === 'number' && now - t < WINDOW_DAYS * DAY).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}
