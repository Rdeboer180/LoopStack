// Notes: what the person captures while looking at their data, kept on this Mac per source (the sample
// patient's notes never mix with a real Nightscout's). Each note stays tied to the data it was about (a
// meal, with a frozen snapshot of the numbers as they were) and is sorted later: for the endo, for
// LoopStack, both, or neither yet. Records are small and self-describing (id, edited-at, status), so a
// phone journal can carry the same shape later. Observations only (SAFE-1): LoopStack's own words in a
// snapshot never advise; the person's text stays in their words. Nothing leaves the Mac from here.
import { useEffect, useState } from 'react';
import { currentScope } from './tracked';

export type NoteAnchor =
  | { kind: 'meal'; food: string; at: number; mealId: string }
  | { kind: 'tile'; tile: string };
export interface NoteSnapshot {
  period: string;
  source: 'synthetic' | 'nightscout';
  /** LoopStack-written, observation-only lines describing what the numbers were. */
  lines: string[];
}
export type NoteStatus = 'open' | 'done' | 'archived';
export interface Note {
  id: string;
  at: number;
  editedAt?: number;
  text: string;
  anchor: NoteAnchor | null;
  snapshot: NoteSnapshot | null;
  forEndo: boolean;
  forLoopStack: boolean;
  status: NoteStatus;
  doneAt?: number;
}

const BASE = 'loopstack.notes.v1';
const key = () => `${BASE}.${currentScope()}`;
export const MAX_TEXT = 2000;

const isStr = (v: unknown): v is string => typeof v === 'string';
/** Old or damaged storage can't hand the UI a malformed note. Pure, for testing. */
export function cleanNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const out: Note[] = [];
  for (const n of value) {
    if (!n || typeof n !== 'object' || !isStr(n.id) || !n.id || !isStr(n.text) || typeof n.at !== 'number' || !Number.isFinite(n.at)) continue;
    const a = n.anchor;
    const anchor: NoteAnchor | null = a && a.kind === 'meal' && isStr(a.food) && typeof a.at === 'number' && isStr(a.mealId) ? { kind: 'meal', food: a.food, at: a.at, mealId: a.mealId }
      : a && a.kind === 'tile' && isStr(a.tile) ? { kind: 'tile', tile: a.tile } : null;
    const sn = n.snapshot;
    const snapshot: NoteSnapshot | null = sn && isStr(sn.period) && (sn.source === 'synthetic' || sn.source === 'nightscout') && Array.isArray(sn.lines)
      ? { period: sn.period, source: sn.source, lines: sn.lines.filter(isStr).slice(0, 8) } : null;
    out.push({
      id: n.id, at: n.at, editedAt: typeof n.editedAt === 'number' ? n.editedAt : undefined,
      text: n.text.slice(0, MAX_TEXT), anchor, snapshot,
      forEndo: n.forEndo === true, forLoopStack: n.forLoopStack === true,
      status: n.status === 'done' || n.status === 'archived' ? n.status : 'open',
      doneAt: typeof n.doneAt === 'number' ? n.doneAt : undefined,
    });
  }
  return out;
}

export type Destination = 'endo' | 'loopstack' | 'both' | 'none';
export const destinationOf = (n: Pick<Note, 'forEndo' | 'forLoopStack'>): Destination =>
  n.forEndo && n.forLoopStack ? 'both' : n.forEndo ? 'endo' : n.forLoopStack ? 'loopstack' : 'none';
export const withDestination = (n: Note, d: Destination, now = Date.now()): Note =>
  ({ ...n, forEndo: d === 'endo' || d === 'both', forLoopStack: d === 'loopstack' || d === 'both', editedAt: now });

export type NoteFilter = 'unsorted' | 'endo' | 'loopstack' | 'done' | 'all';
/** The notes a filter shows, newest first. Archived notes only ever show under Done's undo, never here. Pure. */
export function filterNotes(notes: readonly Note[], f: NoteFilter): Note[] {
  const live = notes.filter((n) => n.status !== 'archived');
  const pick = (n: Note) => f === 'all' ? true
    : f === 'done' ? n.status === 'done'
    : n.status === 'open' && (f === 'unsorted' ? !n.forEndo && !n.forLoopStack : f === 'endo' ? n.forEndo : n.forLoopStack);
  return live.filter(pick).sort((a, b) => b.at - a.at);
}
export const unsortedCount = (notes: readonly Note[]) => filterNotes(notes, 'unsorted').length;

/** What a note was about, in a few words. */
export function anchorLabel(a: NoteAnchor | null): string {
  if (!a) return 'A note';
  if (a.kind === 'meal') return a.food;
  return a.tile;
}

// --- the store ---
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
function read(): Note[] { try { return cleanNotes(JSON.parse(window.localStorage.getItem(key()) ?? '[]')); } catch { return []; } }
function write(notes: Note[]) { try { window.localStorage.setItem(key(), JSON.stringify(notes)); } catch { /* kept for this session only */ } notify(); }
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface NoteDraft { text: string; anchor: NoteAnchor | null; snapshot: NoteSnapshot | null; destination?: Destination }
export interface NoteActions {
  add: (d: NoteDraft) => Note | null;
  setDestination: (id: string, d: Destination) => void;
  setStatus: (id: string, s: NoteStatus) => void;
  edit: (id: string, text: string) => void;
}

export function useNotes(): [Note[], NoteActions] {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const notes = read();
  const change = (id: string, f: (n: Note) => Note) => write(read().map((n) => (n.id === id ? f(n) : n)));
  return [notes, {
    add: (d) => {
      const text = d.text.trim();
      if (!text) return null;
      const dest = d.destination ?? 'none';
      const note: Note = { id: newId(), at: Date.now(), text: text.slice(0, MAX_TEXT), anchor: d.anchor, snapshot: d.snapshot, forEndo: dest === 'endo' || dest === 'both', forLoopStack: dest === 'loopstack' || dest === 'both', status: 'open' };
      write([...read(), note]);
      return note;
    },
    setDestination: (id, d) => change(id, (n) => withDestination(n, d)),
    setStatus: (id, s) => change(id, (n) => ({ ...n, status: s, doneAt: s === 'done' ? Date.now() : undefined, editedAt: Date.now() })),
    edit: (id, text) => { const t = text.trim(); if (t) change(id, (n) => ({ ...n, text: t.slice(0, MAX_TEXT), editedAt: Date.now() })); },
  }];
}
