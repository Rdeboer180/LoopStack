// The portable form of a tracked suggestion: what the phone and the desktop
// both read and write, so they agree on the same record. One id per
// suggestion ('isf', 'carbRatio', 'basal-07', 'food-<slug>'), one confidence
// scale (good / limited / unusable), a dated history, and a lifecycle that
// ends in 'built'. Pure and storage-free: each app keeps its own store and
// only passes records through here. Observations only (SAFE-1); no value in
// a record is ever written to a pump, pod or Loop by this module.

export type PortableConfidence = 'good' | 'limited' | 'unusable';
export type PortableState = 'tracked' | 'staged' | 'built' | 'dismissed';

export interface PortableReading { date: string; confidence: PortableConfidence; reading: number | null }
export interface PortableItem {
  id: string;
  state: PortableState;
  /** First day it was tracked, YYYY-MM-DD. */
  since: string;
  /** Last change, YYYY-MM-DD. The later side wins a merge. */
  updated: string;
  history: PortableReading[];
  /** Set when state is 'built'. */
  builtAt?: string;
  commit?: string;
}

export const TRANSFER_HEADER = 'LoopStack tracked suggestions v1';
const MAX_HISTORY = 60;
const CONF = ['good', 'limited', 'unusable'];
const STATES = ['tracked', 'staged', 'built', 'dismissed'];
const BAD_ID = ['__proto__', 'constructor', 'prototype'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// The ids LoopStack itself makes. Anything else, from a paste or a shared folder, is dropped.
const ID = /^(isf|carbRatio|basal-\d{2}|food-[a-z0-9-]{1,60})$/;

/** Anything damaged or foreign is dropped, never repaired. */
export function cleanItems(value: unknown): PortableItem[] {
  if (!Array.isArray(value)) return [];
  const out: PortableItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<PortableItem>;
    if (typeof r.id !== 'string' || !ID.test(r.id) || BAD_ID.includes(r.id)) continue;
    if (!STATES.includes(r.state ?? '') || typeof r.since !== 'string' || !DAY.test(r.since)) continue;
    const updated = typeof r.updated === 'string' && DAY.test(r.updated) ? r.updated : r.since;
    const history = (Array.isArray(r.history) ? r.history : [])
      .filter((h): h is PortableReading => !!h && typeof h.date === 'string' && DAY.test(h.date) && CONF.includes(h.confidence) && (h.reading === null || (typeof h.reading === 'number' && Number.isFinite(h.reading))))
      .map((h) => ({ date: h.date, confidence: h.confidence, reading: h.reading }))
      .slice(-MAX_HISTORY);
    const item: PortableItem = { id: r.id, state: r.state as PortableState, since: r.since, updated, history };
    if (r.state === 'built') {
      if (typeof r.builtAt === 'string' && DAY.test(r.builtAt)) item.builtAt = r.builtAt;
      if (typeof r.commit === 'string') item.commit = r.commit.slice(0, 40);
    }
    out.push(item);
  }
  return out;
}

/** The text a person copies: a readable header, then the records as JSON. */
export type TransferKind = 'real' | 'sample';

export function encodeTransfer(items: readonly PortableItem[], scopeLabel: string, today: string, kind: TransferKind = 'real'): string {
  const lines = items.map((i) => {
    const last = i.history[i.history.length - 1];
    return `- ${i.id}: ${i.state}${last ? `, ${last.confidence} on ${last.date}` : ''}, ${i.history.length} ${i.history.length === 1 ? 'day' : 'days'} tracked`;
  });
  return [
    TRANSFER_HEADER,
    `${scopeLabel} · ${today}`,
    ...lines,
    '',
    JSON.stringify({ v: 1, kind, items }),
  ].join('\n');
}

export type Parsed = { ok: true; items: PortableItem[]; kind?: TransferKind } | { ok: false; error: string };

/** Accepts what encodeTransfer produced, or its JSON alone. */
export function parseTransfer(text: string): Parsed {
  // Phone keyboards turn typed quotes curly; JSON needs them straight.
  const body = text.trim().replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (!body) return { ok: false, error: 'Nothing to import.' };
  if (body.length > 400_000) return { ok: false, error: 'That is too large to be a copy from LoopStack.' };
  // The JSON is the last line; names in the readable lines above can never be mistaken for it.
  const start = body.startsWith('{') ? 0 : body.lastIndexOf('\n{') + 1;
  if (start <= 0 && !body.startsWith('{')) return { ok: false, error: 'This is not a copy from LoopStack.' };
  try {
    const v = JSON.parse(body.slice(start));
    if (v?.v !== 1 || !Array.isArray(v.items)) return { ok: false, error: 'This copy is from a different version of LoopStack.' };
    const items = cleanItems(v.items);
    if (!items.length) return { ok: false, error: 'No tracked suggestions found in that copy.' };
    return { ok: true, items, kind: v.kind === 'sample' || v.kind === 'real' ? v.kind : undefined };
  } catch {
    return { ok: false, error: 'This is not a copy from LoopStack.' };
  }
}

/** Histories join by date: a day already on this side is never overwritten. */
function joinHistory(a: readonly PortableReading[], b: readonly PortableReading[]): PortableReading[] {
  const byDate = new Map<string, PortableReading>();
  for (const r of b) byDate.set(r.date, r);
  for (const r of a) byDate.set(r.date, r);
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-MAX_HISTORY);
}

// Same-day ties go to the state that took more intent: built, then hidden, then staged, then tracked.
const RANK: Record<PortableState, number> = { built: 3, dismissed: 3, staged: 2, tracked: 1 };

/**
 * Merge incoming records into local ones. Per id: histories join by date, the
 * earlier `since` is kept, and the side changed more recently decides the
 * state. A tie keeps this side. 'built' is final: a build that happened on one
 * device is not undone by the other still showing 'staged'.
 */
export function mergeItems(local: readonly PortableItem[], incoming: readonly PortableItem[]): { items: PortableItem[]; added: number; updated: number } {
  const map = new Map(local.map((i) => [i.id, i]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const cur = map.get(inc.id);
    if (!cur) { map.set(inc.id, inc); added++; continue; }
    const winner = cur.state === 'built' && inc.state === 'built' ? ((inc.builtAt ?? '') > (cur.builtAt ?? '') ? inc : cur) : cur.state === 'built' ? cur : inc.state === 'built' ? inc : inc.updated > cur.updated ? inc : inc.updated === cur.updated && RANK[inc.state] > RANK[cur.state] ? inc : cur;
    const merged: PortableItem = {
      ...winner,
      since: cur.since < inc.since ? cur.since : inc.since,
      updated: cur.updated > inc.updated ? cur.updated : inc.updated,
      history: joinHistory(cur.history, inc.history),
    };
    if (JSON.stringify(merged) !== JSON.stringify(cur)) { map.set(inc.id, merged); updated++; }
  }
  return { items: [...map.values()], added, updated };
}
