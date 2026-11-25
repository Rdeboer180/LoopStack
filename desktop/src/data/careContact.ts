// Your care team's email and your notes for them, kept on this Mac only
// (browser storage, per viewer). Nothing is sent from LoopStack: Email opens
// a new message in your own mail app, addressed and filled in, for you to send.
import { useEffect, useState } from 'react';
import { useNotes } from './notes';

export interface CareContact { name: string; email: string }
/** `at` is when it was written (ms); older notes carry it in their id instead. */
export interface CareNote { id: string; date: string; text: string; at?: number }

const CONTACT_KEY = 'loopstack.careContact';
const NOTES_KEY = 'loopstack.careNotes';
const VISIT_KEY = 'loopstack.careLastVisit';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: kept for this session only */ }
}

/** One plain address: something@domain.tld, no spaces, commas or extra recipients. */
export const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s.trim());

export function cleanNotes(value: unknown): CareNote[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is CareNote => Boolean(n) && typeof n.id === 'string' && typeof n.date === 'string' && typeof n.text === 'string');
}

/** A mailto link for one recipient. Subject and body are encoded, so nothing in them can add recipients or headers. */
export function mailto(to: string, subject: string, body: string) {
  if (!isEmail(to)) return null;
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}?${q}`;
}

/** Notes as an email body, oldest first. */
export const notesBody = (notes: CareNote[]) => notes.map((n) => `${n.date}: ${n.text}`).join('\n\n');

// A tiny shared store so the tile and its detail stay in step.
type Subs = Set<() => void>;
const subs: Subs = new Set();
const notify = () => subs.forEach((f) => f());
function useBump() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
}

export function useCareContact(): [CareContact | null, (c: CareContact | null) => void] {
  useBump();
  const c = read<CareContact | null>(CONTACT_KEY, null);
  const valid = c && typeof c.name === 'string' && isEmail(c.email) ? c : null;
  return [valid, (next) => {
    if (next) write(CONTACT_KEY, { name: next.name.trim(), email: next.email.trim() });
    else { try { window.localStorage.removeItem(CONTACT_KEY); } catch { /* nothing stored */ } }
    notify();
  }];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

/**
 * The notes for the care team: the ones written here before (kept as they were) plus every note
 * flagged "For my endo" in Notes. New ones are written to the Notes store, so there is one place
 * they live; removing one from the care team's list archives it there (it isn't lost).
 */
export function useCareNotes(): [CareNote[], { add: (text: string, date: string) => void; remove: (id: string) => void }] {
  useBump();
  const [stored, actions] = useNotes();
  const legacy = cleanNotes(read<unknown>(NOTES_KEY, []));
  const fromNotes: CareNote[] = stored
    .filter((n) => n.forEndo && n.status === 'open')
    .map((n) => ({ id: n.id, date: dateLabel(n.at), text: n.text, at: n.at }));
  const notes = [...legacy, ...fromNotes].sort((a, b) => noteTime(a) - noteTime(b));
  return [notes, {
    add: (text) => { actions.add({ text, anchor: null, snapshot: null, destination: 'endo' }); },
    remove: (id) => {
      if (stored.some((n) => n.id === id)) actions.setStatus(id, 'archived');
      else { write(NOTES_KEY, legacy.filter((n) => n.id !== id)); notify(); }
    },
  }];
}

/** When a note was written: its own time, or the time its id was made from. */
export function noteTime(n: CareNote): number {
  if (typeof n.at === 'number') return n.at;
  const t = parseInt(n.id.slice(0, -4), 36);
  return Number.isFinite(t) ? t : 0;
}

/** Notes since the last visit, and the ones before it, each oldest first. Pure, for testing. */
export function splitAtVisit(notes: CareNote[], lastVisit: number | null): { since: CareNote[]; before: CareNote[] } {
  if (lastVisit == null) return { since: notes, before: [] };
  return { since: notes.filter((n) => noteTime(n) > lastVisit), before: notes.filter((n) => noteTime(n) <= lastVisit) };
}

/** The last visit, as marked here: notes after it are the ones for the next visit. Null until a visit is marked. */
export function useLastVisit(): [number | null, (at: number | null) => void] {
  useBump();
  const v = read<number | null>(VISIT_KEY, null);
  return [typeof v === 'number' && Number.isFinite(v) ? v : null, (at) => {
    if (at == null) { try { window.localStorage.removeItem(VISIT_KEY); } catch { /* nothing stored */ } }
    else write(VISIT_KEY, at);
    notify();
  }];
}
