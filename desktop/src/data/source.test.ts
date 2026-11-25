import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ useDataset: vi.fn(), build: vi.fn(() => ({ source: 'nightscout' })) }));
vi.mock('./current', () => ({ DATA: {}, useDataset: mock.useDataset }));
vi.mock('./synthetic', () => ({ SYNTHETIC: { source: 'synthetic' } }));
vi.mock('./nightscout', () => ({ buildNightscoutDataset: mock.build }));
const scope = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('./tracked', () => ({ setTrackScope: scope.set, trackScope: (src: string, url?: string) => src === 'synthetic' ? 'sample' : 'ns:' + (url ?? '') }));
import { boot, loadNightscout, showSample } from './source';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const install = (nightscout: object) => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { loopstack: { nightscout }, localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
};
const raw = { entries: [{ date: 1, sgv: 100 }] };
describe('source failures and races', () => {
  it('returns an error rather than rejecting startup when native config fails', async () => {
    install({ config: async () => { throw new Error('Keychain is unavailable'); } });
    await expect(boot()).resolves.toBe('Keychain is unavailable');
  });
  it('does not let a pending read replace a later sample selection', async () => {
    let complete!: (v: object) => void;
    install({ fetch: () => new Promise(r => { complete = r; }) });
    const pending = loadNightscout();
    showSample();
    complete({ ok: true, raw });
    await expect(pending).rejects.toThrow(/source changed/);
    expect(mock.build).not.toHaveBeenCalled();
    expect(mock.useDataset).toHaveBeenCalledWith({ source: 'synthetic' });
  });
  it('only applies the most recent of overlapping reads', async () => {
    let complete!: (v: object) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(r => { complete = r; })).mockResolvedValueOnce({ ok: true, raw });
    install({ fetch });
    const older = loadNightscout();
    await loadNightscout();
    complete({ ok: true, raw });
    await expect(older).rejects.toThrow(/source changed/);
    expect(mock.useDataset).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid records instead of turning them into an empty real dashboard', async () => {
    install({ fetch: async () => ({ ok: true, raw: { entries: [{ date: NaN, sgv: 100 }, { date: 2, sgv: 0 }] } }) });
    await expect(loadNightscout()).rejects.toThrow(/valid CGM/);
    expect(mock.useDataset).not.toHaveBeenCalled();
  });
  it('switches the tracked store to the site before showing its data, and back for the sample', async () => {
    install({ config: async () => ({ url: 'https://mine.example' }), fetch: async () => ({ ok: true, raw }) });
    await loadNightscout();
    expect(scope.set).toHaveBeenLastCalledWith('ns:https://mine.example');
    expect(scope.set.mock.invocationCallOrder[0]).toBeLessThan(mock.useDataset.mock.invocationCallOrder[0]);
    showSample();
    expect(scope.set).toHaveBeenLastCalledWith('sample');
  });
  it('a read whose site address is unavailable still loads, under a store that does not take the old one', async () => {
    install({ config: async () => { throw new Error('Keychain'); }, fetch: async () => ({ ok: true, raw }) });
    await loadNightscout();
    expect(scope.set).toHaveBeenLastCalledWith('ns:');
  });
});
