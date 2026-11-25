import { useSyncExternalStore } from 'react';
import {
  cleanItems,
  encodeTransfer,
  mergeItems,
  parseTransfer,
  type PortableConfidence,
  type PortableItem,
  type PortableState,
} from '@/lib/tracking/transfer';

// Tracked suggestions on this phone, in the record the desktop also reads.
// Observations only: nothing here is written to Loop, a pump or a pod.
const STORAGE_KEY = 'loopstack:tracked:v1';
const MAX_HISTORY = 60;

function readRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

let lastRaw: string | null | undefined;
let snapshot: PortableItem[] = [];

// The snapshot only changes when the stored text does, so
// useSyncExternalStore sees a stable reference between writes.
export function listTracked(): PortableItem[] {
  const raw = readRaw();
  if (raw === lastRaw) return snapshot;
  lastRaw = raw;
  try {
    snapshot = raw ? cleanItems(JSON.parse(raw)) : [];
  } catch {
    snapshot = [];
  }
  return snapshot;
}

const listeners = new Set<() => void>();

function save(next: PortableItem[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable: keep this session's copy in memory
    snapshot = next;
    lastRaw = readRaw();
  }
  for (const l of listeners) l();
}

export interface FirstReading { confidence: PortableConfidence; reading: number | null }

function withReading(history: PortableItem['history'], today: string, r: FirstReading) {
  const rest = history.filter((h) => h.date !== today);
  return [...rest, { date: today, confidence: r.confidence, reading: r.reading }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_HISTORY);
}

/** Start tracking, or take a new day's reading for one already tracked. */
export function track(id: string, today: string, firstReading: FirstReading): void {
  const cur = listTracked();
  const found = cur.find((i) => i.id === id);
  if (!found) {
    save([
      ...cur,
      { id, state: 'tracked', since: today, updated: today, history: withReading([], today, firstReading) },
    ]);
    return;
  }
  if (found.state === 'built') return;
  save(
    cur.map((i) =>
      i.id === id
        ? i.state === 'dismissed'
          ? { ...i, state: 'tracked' as const, updated: today, history: withReading(i.history, today, firstReading) }
          : { ...i, history: withReading(i.history, today, firstReading) }
        : i,
    ),
  );
}

export function setState(id: string, state: PortableState, today: string): void {
  const cur = listTracked();
  const found = cur.find((i) => i.id === id);
  if (!found || found.state === 'built' || state === 'built') return;
  save(cur.map((i) => (i.id === id ? { ...i, state, updated: today } : i)));
}

/** The person built these in their own Loop. Records it; changes nothing else. */
export function markBuilt(ids: readonly string[], commit: string, today: string): void {
  const cur = listTracked();
  if (!cur.some((i) => ids.includes(i.id))) return;
  save(
    cur.map((i) =>
      ids.includes(i.id)
        ? { ...i, state: 'built' as const, updated: today, builtAt: today, commit: commit.slice(0, 40) }
        : i,
    ),
  );
}

export type ImportResult = { ok: true; added: number; updated: number } | { ok: false; error: string };

export function importTransfer(text: string): ImportResult {
  const parsed = parseTransfer(text);
  if (!parsed.ok) return parsed;
  if (parsed.kind === 'sample') return { ok: false, error: 'That copy is from the sample patient. It would mix demo data into your own.' };
  const { items, added, updated } = mergeItems(listTracked(), parsed.items);
  if (added || updated) save(items);
  return { ok: true, added, updated };
}

/** Text to copy to another device. Dismissed items stay on this phone. */
export function exportTransfer(scopeLabel: string, today: string): string {
  return encodeTransfer(listTracked().filter((i) => i.state !== 'dismissed'), scopeLabel, today);
}

export function subscribeTracked(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTracked(): PortableItem[] {
  return useSyncExternalStore(subscribeTracked, listTracked, listTracked);
}
