// Which dataset the app shows: the synthetic patient, or the person's own
// Nightscout once connected (desktop app only; the browser demo has no bridge).
import { DATA, useDataset } from './current';
import { buildNightscoutDataset, type NsRaw } from './nightscout';
import { SYNTHETIC } from './synthetic';
import { sampleFor } from './sampleHistory';
import { setTrackScope, trackScope } from './tracked';

export interface NsConfig { url: string; name: string; hasToken: boolean; connected: boolean }
type Result<T> = { ok: true } & T | { ok: false; error: string };
export interface NightscoutBridge {
  config: () => Promise<NsConfig>;
  connect: (input: { url: string; token: string; name: string }) => Promise<Result<{ version: string | null }>>;
  fetch: (opts?: { days?: number }) => Promise<Result<{ raw: NsRaw & { periodDays?: number } }>>;
  disconnect: () => Promise<{ ok: true }>;
}

export const bridge = (): NightscoutBridge | null => window.loopstack?.nightscout ?? null;

const PREF = 'loopstack.desktop.source';
let requestVersion = 0;

// ---------------------------------------------------------------- the review period
/** The periods the top bar offers. 14 days is the AGP standard and the default. */
export const PERIODS = [14, 30, 90, 180] as const;
export type PeriodDays = (typeof PERIODS)[number];
const PERIOD_KEY = 'loopstack.desktop.period';
export function periodPref(): PeriodDays {
  try { const v = Number(window.localStorage.getItem(PERIOD_KEY)); return (PERIODS as readonly number[]).includes(v) ? v as PeriodDays : 14; } catch { return 14; }
}
function setPeriodPref(d: PeriodDays) {
  try { window.localStorage.setItem(PERIOD_KEY, String(d)); } catch { /* not remembered */ }
}
/** The last Nightscout read, so a shorter period rebuilds from it without reading again. */
let lastRaw: (NsRaw & { periodDays?: number }) | null = null;
/** Periods already built from lastRaw: switching back to one is instant. */
const builtPeriods = new Map<number, ReturnType<typeof buildNightscoutDataset>>();
function builtFor(days: PeriodDays) {
  if (!lastRaw) return null;
  const hit = builtPeriods.get(days);
  if (hit) return hit;
  const ds = buildNightscoutDataset(lastRaw, { days, now: Date.parse(lastRaw.fetchedAt) });
  builtPeriods.set(days, ds);
  return ds;
}
let backgroundRead: Promise<void> | null = null;
/**
 * After the first read, read the longest period quietly in the background, so every shorter
 * period builds without asking Nightscout again. The app keeps showing what it has meanwhile.
 */
function readLongestInBackground(version: number) {
  const b = bridge();
  if (!b || backgroundRead || (lastRaw?.periodDays ?? 14) >= 180) return;
  backgroundRead = new Promise<void>((resolve) => window.setTimeout(resolve, 2500))
    .then(() => b.fetch({ days: 180 }))
    .then((res) => {
      if (version !== requestVersion || !res.ok) return;
      lastRaw = res.raw;
      builtPeriods.clear();
    })
    .catch(() => { /* the next period switch reads what it needs */ })
    .finally(() => { backgroundRead = null; });
}
/** The person can look at the sample patient while connected; remembered per computer. */
export function prefersSample(): boolean {
  try { return window.localStorage.getItem(PREF) === 'sample'; } catch { return false; }
}
function setPref(v: 'sample' | 'nightscout') {
  try { window.localStorage.setItem(PREF, v); } catch { /* storage unavailable */ }
}

/** Read Nightscout and switch the app to it. Throws a person-readable message. */
/**
 * A Nightscout read in flight, for the Glance: 'switch' when it replaces another data set
 * (tiles go to skeletons that keep their shape), 'refresh' when it re-reads the one on
 * screen (values stay, dimmed, under a progress line). Null when nothing is reading.
 */
export type ReadingKind = 'switch' | 'refresh';
let reading: ReadingKind | null = null;
const readingSubs = new Set<() => void>();
export const readingNow = () => reading;
export const onReading = (f: () => void) => { readingSubs.add(f); return () => { readingSubs.delete(f); }; };
const setReading = (k: ReadingKind | null) => { reading = k; for (const f of readingSubs) f(); };

export async function loadNightscout(): Promise<void> {
  setReading(DATA.source === 'nightscout' ? 'refresh' : 'switch');
  try { await readNightscout(); } finally { setReading(null); }
}

async function readNightscout(): Promise<void> {
  const version = ++requestVersion;
  const b = bridge();
  if (!b) throw new Error('Nightscout works in the desktop app.');
  // The site address picks which tracked-suggestions store applies (tracked.ts).
  const config = Promise.resolve().then(() => b.config()).catch(() => null);
  const days = periodPref();
  const res = await b.fetch({ days });
  const cfg = await config;
  if (version !== requestVersion) throw new Error('The data source changed while this read was running. Your selected view was kept.');
  if (!res.ok) throw new Error(res.error);
  if (!res.raw.entries.some(e => Number.isFinite(e.date) && Number.isFinite(e.sgv) && e.sgv > 0)) throw new Error('Connected, but Nightscout has no valid CGM readings from the last 12 weeks.');
  lastRaw = res.raw;
  builtPeriods.clear();
  const next = builtFor(days)!;
  setTrackScope(trackScope('nightscout', cfg?.url));
  useDataset(next);
  setPref('nightscout');
  readLongestInBackground(version);
}

/**
 * Show a different period. A Nightscout read that already covers it is rebuilt in place;
 * a longer one reads Nightscout again. The sample patient has its own longer history.
 */
/** Which period is loading right now (for the dashboard's skeleton), and who's listening. */
let loadingDays: number | null = null;
const loadingSubs = new Set<() => void>();
export const periodLoading = () => loadingDays;
export const onPeriodLoading = (f: () => void) => { loadingSubs.add(f); return () => { loadingSubs.delete(f); }; };
const setLoading = (d: number | null) => { loadingDays = d; for (const f of loadingSubs) f(); };
/** Let the browser paint (the skeleton) before a build that holds the main thread. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export async function setPeriod(days: PeriodDays): Promise<void> {
  setLoading(days);
  try { await paint(); await setPeriodNow(days); } finally { setLoading(null); }
}

async function setPeriodNow(days: PeriodDays): Promise<void> {
  setPeriodPref(days);
  if (DATA === SYNTHETIC || DATA.source === 'synthetic') { useDataset(sampleFor(days)); return; }
  // A background read of the longest period may be about to land: wait for it rather than read twice.
  if (backgroundRead && (lastRaw?.periodDays ?? 14) < days) await backgroundRead;
  if (lastRaw && (lastRaw.periodDays ?? 14) >= days) { useDataset(builtFor(days)!); return; }
  await loadNightscout();
}

export function showSample(): void {
  requestVersion += 1;
  setPref('sample');
  setTrackScope('sample');
  useDataset(sampleFor(periodPref()));
}

/** On launch: connected and not asked for the sample → read Nightscout. */
export async function boot(): Promise<string | null> {
  const b = bridge();
  // The sample patient opens on the remembered period too.
  if (!b || prefersSample()) { if (periodPref() !== 14) useDataset(sampleFor(periodPref())); return null; }
  try {
    const cfg = await b.config();
    if (!cfg.connected || prefersSample()) return null;
    await loadNightscout();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
