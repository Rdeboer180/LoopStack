import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTransfer, importTransfer, listTracked, markBuilt, setState, track } from './trackedStore';

function stubStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

const good = { confidence: 'good' as const, reading: 50 };

describe('trackedStore', () => {
  let mem: Map<string, string>;
  beforeEach(() => { mem = stubStorage(); });

  it('starts empty and survives a bad stored value', () => {
    expect(listTracked()).toEqual([]);
    mem.set('loopstack:tracked:v1', '{nope');
    expect(listTracked()).toEqual([]);
  });

  it('tracks, and takes a new reading on a later day', () => {
    track('isf', '2026-11-20', good);
    track('isf', '2026-11-21', { confidence: 'limited', reading: 48 });
    const [i] = listTracked();
    expect(i.state).toBe('tracked');
    expect(i.since).toBe('2026-11-20');
    expect(i.history.map((h) => h.date)).toEqual(['2026-11-20', '2026-11-21']);
    expect(mem.get('loopstack:tracked:v1')).toContain('"isf"');
  });

  it('sets state, and a built item stays built', () => {
    track('isf', '2026-11-20', good);
    setState('isf', 'staged', '2026-11-21');
    expect(listTracked()[0].state).toBe('staged');
    markBuilt(['isf', 'missing'], 'abc1234', '2026-11-22');
    expect(listTracked()[0]).toMatchObject({ state: 'built', builtAt: '2026-11-22', commit: 'abc1234' });
    setState('isf', 'dismissed', '2026-11-23');
    track('isf', '2026-11-23', good);
    expect(listTracked()[0].state).toBe('built');
  });

  it('brings a dismissed item back when tracked again', () => {
    track('isf', '2026-11-20', good);
    setState('isf', 'dismissed', '2026-11-21');
    track('isf', '2026-11-22', good);
    expect(listTracked()[0].state).toBe('tracked');
  });

  it('exports without dismissed items and imports on another phone', () => {
    track('isf', '2026-11-20', good);
    track('carbRatio', '2026-11-20', good);
    setState('carbRatio', 'dismissed', '2026-11-21');
    const text = exportTransfer('This phone', '2026-11-22');
    expect(text).toContain('isf');
    expect(text).not.toContain('carbRatio');
    mem.clear();
    expect(importTransfer(text)).toEqual({ ok: true, added: 1, updated: 0 });
    expect(importTransfer(text)).toEqual({ ok: true, added: 0, updated: 0 });
    expect(listTracked().map((i) => i.id)).toEqual(['isf']);
  });

  it('reports a bad import without changing anything', () => {
    track('isf', '2026-11-20', good);
    const r = importTransfer('hello');
    expect(r.ok).toBe(false);
    expect(listTracked()).toHaveLength(1);
  });

  it('keeps working in memory when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('no'); },
      setItem: () => { throw new Error('no'); },
    });
    expect(listTracked()).toEqual([]);
    expect(() => track('isf', '2026-11-20', good)).not.toThrow();
  });
});
