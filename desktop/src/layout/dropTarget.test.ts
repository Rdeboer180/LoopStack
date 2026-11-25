import { describe, expect, it } from 'vitest';
import { dropTarget, type Placed } from './dropTarget';

// One row: A (0–100), B (110–310, wider), C (320–420). Second row: D under all.
const row: Placed[] = [
  { id: 'glucose-now', box: { left: 0, top: 0, right: 100, bottom: 100 } },
  { id: 'heads-ups', box: { left: 110, top: 0, right: 310, bottom: 100 } },
  { id: 'device-life', box: { left: 320, top: 0, right: 420, bottom: 100 } },
  { id: 'meals', box: { left: 0, top: 110, right: 420, bottom: 310 } },
];

describe('where a dragged tile lands', () => {
  it('stays put until the pointer passes the middle of the next tile', () => {
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 150, y: 50, displaced: null })).toBeNull();
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 250, y: 50, displaced: null })).toEqual({ index: 1, over: 'heads-ups' });
  });

  it('moving back needs the pointer before the middle', () => {
    expect(dropTarget({ tiles: row, id: 'device-life', x: 260, y: 50, displaced: null })).toBeNull();
    expect(dropTarget({ tiles: row, id: 'device-life', x: 150, y: 50, displaced: null })).toEqual({ index: 1, over: 'heads-ups' });
  });

  it('the tile that just moved aside cannot take the place straight back', () => {
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 250, y: 50, displaced: 'heads-ups' })).toBeNull();
  });

  it('a tile in another row moves once the pointer is a third of the way in', () => {
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 50, y: 150, displaced: null })).toBeNull();
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 50, y: 200, displaced: null })).toEqual({ index: 3, over: 'meals' });
  });

  it('below everything goes to the end', () => {
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 50, y: 400, displaced: null })).toEqual({ index: 3, over: null });
    expect(dropTarget({ tiles: row, id: 'meals', x: 50, y: 400, displaced: null })).toBeNull();
  });

  it('from the library: before a tile in its first half, after it in the second', () => {
    expect(dropTarget({ tiles: row, id: 'key-numbers', x: 130, y: 50, displaced: null })).toEqual({ index: 1, over: 'heads-ups' });
    expect(dropTarget({ tiles: row, id: 'key-numbers', x: 300, y: 50, displaced: null })).toEqual({ index: 2, over: 'heads-ups' });
    expect(dropTarget({ tiles: row, id: 'key-numbers', x: 50, y: 400, displaced: null })).toEqual({ index: 4, over: null });
  });

  it('a gap between tiles changes nothing', () => {
    expect(dropTarget({ tiles: row, id: 'glucose-now', x: 105, y: 50, displaced: null })).toBeNull();
  });
});
