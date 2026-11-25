// Where a dragged tile should land (edit-layout pass, Nov 24). Pure, so the
// pointer rules are tested apart from the DOM.
//
// The old rule swapped the moment the pointer touched any other tile. With
// tiles of different sizes the swap moved a new tile under the pointer, which
// swapped back: the jitter. Two rules stop it:
//   midpoint   a tile gives up its place only once the pointer is past its
//              middle, in the direction of travel
//   displaced  the tile that just moved aside can't take the place straight
//              back until the pointer has left it
import type { TileKind } from './model';

export interface Box { left: number; top: number; right: number; bottom: number }
export interface Placed { id: TileKind; box: Box }

export interface DropInput {
  /** The tiles as drawn now, in reading order, including the dragged one's placeholder (absent for a tile coming from the library). */
  tiles: readonly Placed[];
  /** The tile being dragged. */
  id: TileKind;
  /** Pointer, in the same coordinates as the boxes. */
  x: number;
  y: number;
  /** The tile that last moved aside for this drag, if the pointer is still over it. */
  displaced: TileKind | null;
}

export interface DropResult { index: number; over: TileKind | null }

const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
const sameRow = (a: Box, b: Box) => a.top < b.bottom && a.bottom > b.top;

/** The reading-order index the dragged tile should move to, or null to stay put. */
export function dropTarget({ tiles, id, x, y, displaced }: DropInput): DropResult | null {
  const cur = tiles.findIndex((t) => t.id === id);
  const over = tiles.find((t) => t.id !== id && inside(t.box, x, y));
  if (!over) {
    // Below everything: the end of the dashboard.
    const bottom = tiles.reduce((m, t) => Math.max(m, t.box.bottom), 0);
    const last = cur < 0 ? tiles.length : tiles.length - 1;
    if (tiles.length && y > bottom && cur !== last) return { index: last, over: null };
    return null;
  }
  if (over.id === displaced) return null;
  const j = tiles.indexOf(over);
  const b = over.box;
  const cx = (b.left + b.right) / 2;
  const third = (b.bottom - b.top) / 3;
  if (cur < 0) {
    // From the library: before this tile in its first half, after it in the second.
    const before = x < cx;
    return { index: before ? j : j + 1, over: over.id };
  }
  const row = sameRow(tiles[cur].box, b);
  if (j > cur) {
    const past = row ? x > cx : y > b.top + third;
    return past ? { index: j, over: over.id } : null;
  }
  const before = row ? x < cx : y < b.bottom - third;
  return before ? { index: j, over: over.id } : null;
}
