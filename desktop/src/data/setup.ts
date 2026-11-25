// First-run setup: which steps are done, which were skipped, and whether the stepper should open.
// Only the person's own choices are stored (on this Mac, in the browser's storage): never a token,
// key or address; those live in the keychain through each bridge. Pure helpers are tested.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { aiBridge } from './ai';
import { useCareContact } from './careContact';
import { githubBridge } from './loopBuild';
import { bridge as nsBridge, prefersSample } from './source';

/** The checklist in Settings: what makes LoopStack yours. Only the first is needed. */
export type StepId = 'data' | 'dashboard' | 'care' | 'tools';
export const STEP_IDS: readonly StepId[] = ['data', 'dashboard', 'care', 'tools'];
export const STEP_TITLE: Record<StepId, string> = {
  data: 'Connect your data',
  dashboard: 'Choose your dashboard',
  care: 'Add your care team',
  tools: 'Ask and build tools',
};
/** The first-run stepper is shorter: your data, your dashboard, then a quiet "you're set". Care team and the
 *  tools are set up where they're used (Care-team review, Ask & build, Feature library), not up front. */
export type StepperId = 'data' | 'dashboard' | 'done';
export const STEPPER_IDS: readonly StepperId[] = ['data', 'dashboard', 'done'];
/** Only the first step is needed; everything else can wait. */
export const REQUIRED: readonly StepId[] = ['data'];

const KEY = 'loopstack.setup.v1';
export interface Saved {
  /** The stepper has been finished or set aside: don't open it on its own again. */
  closed: boolean;
  /** Steps the person chose to skip for now. */
  skipped: StepId[];
  /** The person picked a layout in setup (so "your dashboard" counts as done). */
  layoutChosen: boolean;
}
const EMPTY: Saved = { closed: false, skipped: [], layoutChosen: false };

export function parseSaved(raw: unknown): Saved {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as Partial<Saved>;
  return {
    closed: r.closed === true,
    skipped: Array.isArray(r.skipped) ? r.skipped.filter((s): s is StepId => (STEP_IDS as readonly string[]).includes(s as string)) : [],
    layoutChosen: r.layoutChosen === true,
  };
}

const readSaved = (): Saved => { try { return parseSaved(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')); } catch { return EMPTY; } };
const subs = new Set<() => void>();
let snapshot: Saved | null = null;
const getSnapshot = () => (snapshot ??= readSaved());
export function saveSetup(patch: Partial<Saved>) {
  snapshot = { ...getSnapshot(), ...patch };
  try { window.localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* kept for this session */ }
  for (const f of subs) f();
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** What the world looks like right now: what's connected, chosen or filled in. */
export interface Facts { nightscout: boolean; sample: boolean; layoutChosen: boolean; careContact: boolean; claude: boolean; github: boolean }
export type StepState = 'done' | 'skipped' | 'todo';

/** Each step's state. A step the person skipped stays "skipped" until it's actually done. Pure. */
export function stepStates(f: Facts, skipped: readonly StepId[]): Record<StepId, StepState> {
  const done: Record<StepId, boolean> = {
    data: f.nightscout || f.sample,
    dashboard: f.layoutChosen,
    care: f.careContact,
    // Done once either is connected; they're two separate things, each named where it's used.
    tools: f.claude || f.github,
  };
  const out = {} as Record<StepId, StepState>;
  for (const id of STEP_IDS) out[id] = done[id] ? 'done' : skipped.includes(id) ? 'skipped' : 'todo';
  return out;
}

/** "Setup · 2 of 5". */
export function progressWords(states: Record<StepId, StepState>): string {
  const n = STEP_IDS.filter((id) => states[id] === 'done').length;
  return `Setup · ${n} of ${STEP_IDS.length}`;
}

/** The first step still to do, or null. */
export const nextStep = (states: Record<StepId, StepState>): StepId | null => STEP_IDS.find((id) => states[id] === 'todo') ?? null;

/** Should the stepper open on its own at launch? Only on a first run: nothing connected, never closed. */
export const shouldOpenOnLaunch = (saved: Saved, f: Facts, hasBridge: boolean): boolean =>
  !saved.closed && hasBridge && !f.nightscout && !f.sample;

// --- the stepper's own open/step state, kept here (not in React) because connecting Nightscout swaps
// the dataset and remounts the app: the stepper must still be open, on the same step, afterwards. ---
interface Ui { open: boolean; step: StepperId }
let ui: Ui = { open: false, step: 'data' };
const uiSubs = new Set<() => void>();
const setUi = (next: Ui) => { ui = next; for (const f of uiSubs) f(); };
export const openSetup = (step: StepperId = 'data') => setUi({ open: true, step });
export const closeSetup = () => setUi({ ...ui, open: false });
export const goSetupStep = (step: StepperId) => setUi({ open: true, step });
export const useSetupUi = (): Ui => useSyncExternalStore((f) => { uiSubs.add(f); return () => { uiSubs.delete(f); }; }, () => ui);

/** Live facts from the bridges (each read once, and again when asked). `ready` is false until the first read lands. */
export function useSetup() {
  const saved = useSyncExternalStore(subscribe, getSnapshot);
  const [contact] = useCareContact();
  const [facts, setFacts] = useState<Omit<Facts, 'careContact' | 'layoutChosen'>>({ nightscout: false, sample: prefersSample(), claude: false, github: false });
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const [ns, ai, gh] = await Promise.all([
      nsBridge()?.config().catch(() => null) ?? null,
      aiBridge()?.config().catch(() => null) ?? null,
      githubBridge()?.config().catch(() => null) ?? null,
    ]);
    setFacts({ nightscout: !!ns?.connected, sample: prefersSample(), claude: !!ai?.connected, github: !!gh?.connected });
    setReady(true);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const all: Facts = { ...facts, layoutChosen: saved.layoutChosen, careContact: !!contact };
  return { saved, facts: all, states: stepStates(all, saved.skipped), ready, refresh, hasBridge: !!nsBridge() };
}
