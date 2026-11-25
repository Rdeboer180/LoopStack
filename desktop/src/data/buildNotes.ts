// Build notes on this Mac, and the optional sync folder. When your tracked
// records change, the desktop shell writes them (with the Build notes brief)
// to one file that a read-only MCP server can serve to your own LLM, and, if
// you chose a sync folder, merges that folder's file with this Mac's records.
// Observations only (SAFE-1): nothing here writes to Loop, a pump or a pod.
import { DATA, SUGGESTIONS } from './current';
import { briefFor } from './nextBuild';
import { eligibleForBuild } from './suggestions';
import { currentScope, mergeFromFolder, onTrackedWrite, readTracked, toPortable, type Tracked } from './tracked';
import type { PortableItem } from '@/lib/tracking/transfer';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface BuildNotesBridge {
  save: (input: { scope: string; items: PortableItem[]; brief?: string }) => Promise<Result<{ sync?: Result<object> | null }>>;
  paths: () => Promise<Result<{ script: string; file: string; scriptExists: boolean }>>;
}
export interface SyncBridge {
  config: () => Promise<Result<{ folder: string | null }>>;
  choose: () => Promise<Result<{ folder: string | null; canceled?: boolean; error?: string }>>;
  clear: () => Promise<Result<{ folder: null }>>;
  onMerged: (cb: (v: { scope: string; items: PortableItem[] }) => void) => () => void;
}
export const buildNotesBridge = (): BuildNotesBridge | null => window.loopstack?.buildNotes ?? null;
export const syncBridge = (): SyncBridge | null => window.loopstack?.sync ?? null;

/** The brief for what is staged right now, the same text Copy for your LLM gives. */
export function currentBrief(all: Record<string, Tracked>): string | undefined {
  try {
    const staged = SUGGESTIONS.filter((s) => all[s.id]?.state === 'staged' && eligibleForBuild(s).ok);
    return staged.length ? briefFor(staged, all, DATA.today) : undefined;
  } catch { return undefined; }
}

let timer: number | undefined;
function push(scope: string, all: Record<string, Tracked>) {
  const bridge = buildNotesBridge();
  if (!bridge) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void bridge.save({ scope, items: toPortable(all, undefined, true), brief: currentBrief(all) }).catch(() => undefined);
  }, 400);
}

/** Called once at startup: wires the write hook, the folder listener, and an initial save. */
export function bootBuildNotes(): void {
  if (!buildNotesBridge()) return;
  onTrackedWrite(push);
  push(currentScope(), readTracked());
  syncBridge()?.onMerged((v) => mergeFromFolder(v.scope, v.items));
}
