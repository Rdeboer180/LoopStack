// What you've chosen to track among the suggestions, kept on this Mac only.
// tracked: watching it build confidence · staged: in your next build
// dismissed: hidden. Each load records the grade it read that day, which is
// the confidence history a card shows.
//
// Kept per data source. Suggestion ids ('isf', 'carbRatio', 'basal-07') are
// the same for every patient, so one shared store let a choice made on the
// sample patient stage the person's own reading for their next build. The
// sample patient has one store; each Nightscout site has its own, keyed by a
// hash so the address isn't written into storage keys.
import { useEffect, useState } from 'react';
import type { Confidence } from '@/lib/metabolism/autotune';
import { cleanItems, mergeItems, type PortableItem } from '@/lib/tracking/transfer';

export type TrackState = 'tracked' | 'staged' | 'built' | 'dismissed';
/** branch: its own patch with a switch in the Feature library · code: folded into one proposals patch. */
export type BuildAs = 'branch' | 'code';
export interface Reading { date: string; confidence: Confidence; reading: number | null }
export interface Tracked { id: string; state: TrackState; since: string; buildAs: BuildAs; history: Reading[]; updated?: string; builtAt?: string; commit?: string }

const KEY = 'loopstack.tracked';
const SEEN_KEY = 'loopstack.suggestionsSeen';
const MAX_HISTORY = 60;

/** The store a data source uses: 'sample', or 'ns-' and a hash of the Nightscout site. */
export function trackScope(source: 'synthetic' | 'nightscout', url?: string | null): string {
  if (source === 'synthetic') return 'sample';
  const site = (url ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!site) return 'ns';
  let h = 0x811c9dc5;
  for (const ch of site) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return 'ns-' + h.toString(36);
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/**
 * Migration: the one store from before partitioning held the person's own
 * choices (the sample patient is a demo), so the first Nightscout site to load
 * takes it over and the old key is removed. The sample patient starts empty.
 * A site whose address couldn't be read ('ns') doesn't take it, so it isn't
 * lost to a temporary scope. Pure over `store`, for testing.
 */
export function adoptLegacy(store: Store, scope: string): void {
  if (!scope.startsWith('ns-')) return;
  for (const base of [KEY, SEEN_KEY]) {
    const legacy = store.getItem(base);
    if (legacy == null) continue;
    if (store.getItem(base + '.' + scope) == null) store.setItem(base + '.' + scope, legacy);
    store.removeItem(base);
  }
}

const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

let scope = 'sample';
const key = (base: string) => base + '.' + scope;
/** Which source's records apply right now ('sample', or a Nightscout site), for stores that follow it. */
export const currentScope = () => scope;
/** Called by source.ts before the app switches datasets. */
export function setTrackScope(next: string): void {
  if (next === scope) return;
  scope = next;
  try { adoptLegacy(window.localStorage, scope); } catch { /* storage unavailable */ }
  try { writeHook?.(scope, read()); } catch { /* a listener never blocks a switch */ }
  notify();
}

/** Old or damaged storage cannot supply a malformed history to the UI. */
export function cleanTracked(value: unknown): Record<string, Tracked> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, Tracked> = {};
  for (const [id, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
    const t = item as Partial<Tracked>;
    if (!['tracked', 'staged', 'built', 'dismissed'].includes(t.state ?? '') || typeof t.since !== 'string') continue;
    const history = Array.isArray(t.history) ? t.history.filter(r => r && typeof r.date === 'string' && ['good', 'limited', 'unusable'].includes(r.confidence) && (r.reading === null || Number.isFinite(r.reading))).slice(-MAX_HISTORY) : [];
    out[id] = { id, state: t.state!, since: t.since, buildAs: t.buildAs === 'branch' ? 'branch' : 'code', history, ...(typeof t.updated === 'string' ? { updated: t.updated } : {}), ...(typeof t.builtAt === 'string' ? { builtAt: t.builtAt } : {}), ...(typeof t.commit === 'string' ? { commit: t.commit.slice(0, 40) } : {}) };
  }
  return out;
}

function read(): Record<string, Tracked> {
  try {
    const raw = window.localStorage.getItem(key(KEY));
    const v = raw ? JSON.parse(raw) : {};
    return cleanTracked(v);
  } catch {
    return {};
  }
}
function write(v: Record<string, Tracked>) {
  try { window.localStorage.setItem(key(KEY), JSON.stringify(v)); } catch { /* storage blocked: this session only */ }
  try { writeHook?.(scope, v); } catch { /* a listener never blocks a save */ }
}

/** Told after every write of this source's records (the build-notes file and folder sync hang off it). */
let writeHook: ((scope: string, all: Record<string, Tracked>) => void) | null = null;
export function onTrackedWrite(f: ((scope: string, all: Record<string, Tracked>) => void) | null): void { writeHook = f; }
/** The current source's records, read fresh. */
export const readTracked = (): Record<string, Tracked> => read();


/** Adds today's reading to every tracked item's history, once a day per item. Pure, for testing. */
export function recordReadings(all: Record<string, Tracked>, today: string, now: { id: string; confidence: Confidence; reading: number | null }[]): Record<string, Tracked> {
  const next = { ...all };
  for (const r of now) {
    const t = next[r.id];
    if (!t || t.state === 'dismissed') continue;
    const last = t.history[t.history.length - 1];
    if (last && last.date === today) continue;
    next[r.id] = { ...t, history: [...t.history, { date: today, confidence: r.confidence, reading: r.reading }].slice(-MAX_HISTORY) };
  }
  return next;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** This app shows days as "Nov 13"; the portable form (phone, copy, folder) uses YYYY-MM-DD. A day that hasn't happened yet this year belongs to last year. */
export function isoDay(day: string, now: Date = new Date()): string {
  const m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(day);
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || mi < 0) return day;
  let y = now.getFullYear();
  if (new Date(y, mi, Number(m[2])).getTime() > now.getTime() + 864e5) y -= 1;
  return `${y}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
/** The reverse, so what comes in from a copy reads like the rest of the app. */
export function displayDay(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  const mi = m ? Number(m[1]) - 1 : -1;
  return m && mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${Number(m[2])}` : day;
}

/** The records as both apps share them. Dismissed items are local choices and stay home. */
export function toPortable(all: Record<string, Tracked>, onlyIds?: ReadonlySet<string>, includeDismissed = false, now: Date = new Date()): PortableItem[] {
  const iso = (d: string) => isoDay(d, now);
  return cleanItems(Object.values(all)
    .filter((t) => (includeDismissed || t.state !== 'dismissed') && (!onlyIds || onlyIds.has(t.id)))
    .map((t) => ({ id: t.id, state: t.state, since: iso(t.since), updated: iso(t.updated ?? t.since), history: t.history.map((h) => ({ ...h, date: iso(h.date) })), builtAt: t.builtAt ? iso(t.builtAt) : undefined, commit: t.commit })));
}

/** A portable record back into this app's day format. */
function fromPortable(cur: Tracked | undefined, i: PortableItem): Tracked {
  return { ...cur, id: i.id, state: i.state, since: displayDay(i.since), updated: displayDay(i.updated), buildAs: cur?.buildAs ?? 'code', history: i.history.map((h) => ({ ...h, date: displayDay(h.date) })), builtAt: i.builtAt ? displayDay(i.builtAt) : undefined, commit: i.commit };
}

// Stopping tracking leaves a dated note, so a sync folder or a paste that still
// has the item (changed no later than that day) can't bring it back.
const GONE_KEY = 'loopstack.trackedForgotten';
function readGone(): Record<string, string> {
  try { const v = JSON.parse(window.localStorage.getItem(key(GONE_KEY)) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function writeGone(v: Record<string, string>) {
  try { window.localStorage.setItem(key(GONE_KEY), JSON.stringify(v)); } catch { /* storage blocked */ }
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Incoming records minus the ones this Mac stopped tracking after they last changed. Pure, for testing. */
export function withoutForgotten(incoming: PortableItem[], gone: Record<string, string>): PortableItem[] {
  return incoming.filter((i) => !(Object.prototype.hasOwnProperty.call(gone, i.id) && i.updated <= gone[i.id]));
}

/** Records the sync folder taught this Mac, for `forScope` only. Writes (and so re-saves) only when something changed. */
export function mergeFromFolder(forScope: string, incoming: PortableItem[]): void {
  if (forScope !== scope) return;
  const cur = read();
  const r = mergeItems(toPortable(cur, undefined, true), withoutForgotten(cleanItems(incoming), readGone()));
  if (!r.added && !r.updated) return;
  const next: Record<string, Tracked> = { ...cur };
  for (const i of r.items) next[i.id] = fromPortable(cur[i.id], i);
  write(cleanTracked(next));
  notify();
}

export function useTracked() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const all = read();
  const set = (id: string, patch: Partial<Tracked> & { state?: TrackState }, today: string, first?: Reading) => {
    const cur = read();
    const prev = cur[id];
    const gone = readGone();
    if (gone[id]) { delete gone[id]; writeGone(gone); }
    cur[id] = prev ? { ...prev, ...patch, updated: today } : { id, state: patch.state ?? 'tracked', since: today, buildAs: patch.buildAs ?? 'code', history: first ? [first] : [], updated: today };
    write(cur);
    notify();
  };
  return {
    all,
    track: (id: string, today: string, first: Reading) => set(id, { state: 'tracked' }, today, first),
    stage: (id: string, today: string, first: Reading) => set(id, { state: 'staged' }, today, first),
    unstage: (id: string, today: string) => set(id, { state: 'tracked' }, today),
    dismiss: (id: string, today: string) => set(id, { state: 'dismissed' }, today),
    /** After a commit: the item stays, as Built, with its history. */
    markBuilt: (ids: string[], commit: string, today: string) => {
      const cur = read();
      for (const id of ids) if (cur[id]) cur[id] = { ...cur[id], state: 'built', builtAt: today, commit, updated: today };
      write(cur);
      notify();
    },
    /** Merge records copied from the phone or another Mac into this source's store. */
    importItems: (incoming: PortableItem[]) => {
      const cur = read();
      const local = toPortable(cur, undefined, true);
      const r = mergeItems(local, withoutForgotten(incoming, readGone()));
      const next: Record<string, Tracked> = { ...cur };
      for (const i of r.items) next[i.id] = fromPortable(cur[i.id], i);
      write(cleanTracked(next));
      notify();
      return { added: r.added, updated: r.updated };
    },
    forget: (id: string) => { const cur = read(); delete cur[id]; writeGone({ ...readGone(), [id]: todayIso() }); write(cur); notify(); },
    buildAs: (id: string, as: BuildAs, today: string) => set(id, { buildAs: as }, today),
    record: (today: string, now: { id: string; confidence: Confidence; reading: number | null }[]) => {
      const cur = read();
      const next = recordReadings(cur, today, now);
      if (JSON.stringify(next) !== JSON.stringify(cur)) { write(next); notify(); }
    },
  };
}

// ------------------------------------------------------------ the Suggestions nav badge
// New: suggestions you haven't seen, haven't tracked and haven't hidden.
// Reached confidence: tracked readings that now pass the build gate (SAFE-5a)
// and haven't been announced yet. Opening Suggestions clears both.
interface Seen { ids: string[]; ready: string[] }
function readSeen(): Seen {
  try {
    const v = JSON.parse(window.localStorage.getItem(key(SEEN_KEY)) ?? 'null');
    return v && Array.isArray(v.ids) && Array.isArray(v.ready) ? v : { ids: [], ready: [] };
  } catch {
    return { ids: [], ready: [] };
  }
}
function writeSeen(v: Seen) {
  try { window.localStorage.setItem(key(SEEN_KEY), JSON.stringify(v)); } catch { /* storage blocked */ }
  notify();
}

/** The two counts behind the badge. Pure, for testing. */
export function badgeCounts(all: { id: string; ready: boolean }[], tracked: Record<string, Tracked>, seen: Seen) {
  const ids = new Set(seen.ids);
  const ready = new Set(seen.ready);
  const fresh = all.filter((s) => !tracked[s.id] && !ids.has(s.id)).length;
  const reached = all.filter((s) => tracked[s.id]?.state === 'tracked' && s.ready && !ready.has(s.id)).length;
  return { fresh, reached, total: fresh + reached };
}

/** The badge counts right now, from the current source's store. */
export function badgeNow(items: { id: string; ready: boolean }[]) {
  return badgeCounts(items, read(), readSeen());
}

/** The badge counts, live. `items` is every suggestion with whether it passes the build gate now. */
export function useSuggestionsBadge(items: { id: string; ready: boolean }[]) {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return badgeNow(items);
}

/** Opening Suggestions: everything listed is seen, and every tracked reading that's ready has been announced. */
export function markSuggestionsSeen(items: { id: string; ready: boolean }[]) {
  const cur = readSeen();
  const next = { ids: [...new Set([...cur.ids, ...items.map((s) => s.id)])], ready: [...new Set([...cur.ready, ...items.filter((s) => s.ready).map((s) => s.id)])] };
  if (next.ids.length !== cur.ids.length || next.ready.length !== cur.ready.length) writeSeen(next);
}
