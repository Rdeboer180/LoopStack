import { describe, expect, it } from 'vitest';
import { cleanNotes, destinationOf, filterNotes, unsortedCount, withDestination, type Note } from './notes';
import { mealLines } from './noteAnchors';

const note = (o: Partial<Note> = {}): Note => ({ id: 'a', at: 1, text: 'hi', anchor: null, snapshot: null, forEndo: false, forLoopStack: false, status: 'open', ...o });

describe('notes', () => {
  it('sorts by destination: endo, LoopStack, both, or neither', () => {
    expect(destinationOf(note())).toBe('none');
    expect(destinationOf(note({ forEndo: true }))).toBe('endo');
    expect(destinationOf(note({ forLoopStack: true }))).toBe('loopstack');
    expect(destinationOf(note({ forEndo: true, forLoopStack: true }))).toBe('both');
    const n = withDestination(note(), 'both', 5);
    expect(n).toMatchObject({ forEndo: true, forLoopStack: true, editedAt: 5 });
    expect(withDestination(n, 'none')).toMatchObject({ forEndo: false, forLoopStack: false });
  });
  it('filters, newest first, and never shows archived', () => {
    const ns = [note({ id: '1', at: 1 }), note({ id: '2', at: 2, forEndo: true }), note({ id: '3', at: 3, forEndo: true, forLoopStack: true }), note({ id: '4', at: 4, status: 'done' }), note({ id: '5', at: 5, status: 'archived' })];
    expect(filterNotes(ns, 'unsorted').map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(ns, 'endo').map((n) => n.id)).toEqual(['3', '2']);
    expect(filterNotes(ns, 'loopstack').map((n) => n.id)).toEqual(['3']);
    expect(filterNotes(ns, 'done').map((n) => n.id)).toEqual(['4']);
    expect(filterNotes(ns, 'all').map((n) => n.id)).toEqual(['4', '3', '2', '1']);
    expect(unsortedCount(ns)).toBe(1);
  });
  it('reads storage defensively', () => {
    expect(cleanNotes('nope')).toEqual([]);
    const out = cleanNotes([{ id: 'x', at: 2, text: 'ok', forEndo: true, status: 'weird', anchor: { kind: 'meal', food: 'Oatmeal', at: 1, mealId: 'm' } }, { id: '', at: 1, text: 'no id' }, { id: 'y', at: 'bad', text: 't' }, null]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'x', forEndo: true, forLoopStack: false, status: 'open', anchor: { kind: 'meal', food: 'Oatmeal' } });
  });
  it('describes a meal in plain observations, never advice', () => {
    const lines = mealLines({ when: 'Fri Nov 13, 6:26am', carbsG: 45, bolusU: 3.9, startMgdl: 112, peakMgdl: 157, peakAfterMin: 88, outcome: 'in', observedMin: 195, enteredMin: 180 } as never);
    expect(lines).toEqual(['Fri Nov 13, 6:26am: 45 g with 3.9 U', 'Glucose 112, peaked at 157 after 1h 28m, then stayed 65–180', 'Absorbed in 3h 15m (3h entered)']);
  });
});
