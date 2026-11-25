// Every state the app can open in lives in the URL query, so each one can be
// linked, screenshotted or recorded directly:
//   ?view=dashboard                         My dashboard
//   ?view=dashboard&edit=1                  edit mode with the library open
//   ?view=dashboard&preset=before-visit     load a preset layout
//   ?view=dashboard&tile=what-loop-did&detail=1   a tile's detail face
//   ?view=review&patient=sam&section=loop   the care-team review
//   ?view=suggestions                       suggestions, tracked to confidence
//   ?view=notes                             your notes, to sort for the endo or LoopStack
//   ?view=library                           the feature library
//   ?reset=1                                clear the saved layout
import type { Mode } from './data/derive';
import type { ReviewSection } from './data/review';
import { ALL_KINDS, PRESET_IDS, type PresetId, type TileKind } from './layout/model';

export type View = 'dashboard' | 'review' | 'notes' | 'changes' | 'suggestions' | 'library' | 'assistant' | 'settings';
const VIEWS: View[] = ['dashboard', 'review', 'notes', 'changes', 'suggestions', 'library', 'assistant', 'settings'];
const SECTIONS: ReviewSection[] = ['glucose', 'loop', 'changes', 'trends', 'notes'];

export interface HourSelection { weekday: number; hour: number }

export interface Route {
  evidence?: HourSelection;
  view: View;
  edit: boolean;
  /** The tile whose detail face is open. */
  tile: TileKind | null;
  patient: string;
  section: ReviewSection;
  /** What Loop did: hours or 3-hour blocks, and the selected column. */
  mode: Mode;
  sel: number;
}

export interface Boot {
  route: Route;
  preset: PresetId | null;
  reset: boolean;
}

const int = (v: string | null, lo: number, hi: number, dflt: number) => {
  const n = v == null ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

export function parse(search: string): Boot {
  const q = new URLSearchParams(search);
  const view = (VIEWS as string[]).includes(q.get('view') ?? '') ? (q.get('view') as View) : 'dashboard';
  const t = q.get('tile');
  const tile = q.get('detail') === '1' && t && (ALL_KINDS as string[]).includes(t) ? (t as TileKind) : null;
  const s = q.get('section');
  const mode: Mode = q.get('mode') === 'blocks' ? 'blocks' : 'hours';
  const p = q.get('preset');
  const wd = q.get('weekday') ?? '';
  const hr = q.get('hour') ?? '';
  const evidence = /^[0-6]$/.test(wd) && /^(?:[0-9]|1[0-9]|2[0-3])$/.test(hr) &&
    (view === 'dashboard' || view === 'assistant') ? { weekday: Number(wd), hour: Number(hr) } : undefined;
  return {
    route: {
      view,
      evidence,
      edit: view === 'dashboard' && q.get('edit') === '1',
      tile: view === 'dashboard' ? tile : null,
      patient: q.get('patient') || 'sam',
      section: (SECTIONS as string[]).includes(s ?? '') ? (s as ReviewSection) : 'glucose',
      mode,
      sel: int(q.get('sel'), 0, mode === 'blocks' ? 7 : 23, mode === 'blocks' ? 2 : 7),
    },
    preset: p && (PRESET_IDS as string[]).includes(p) ? (p as PresetId) : null,
    reset: q.get('reset') === '1',
  };
}

export function toSearch(r: Route): string {
  const q = new URLSearchParams();
  q.set('view', r.view);
  if (r.evidence && (r.view === 'dashboard' || r.view === 'assistant')) {
    q.set('weekday', String(r.evidence.weekday));
    q.set('hour', String(r.evidence.hour));
  }
  if (r.view === 'dashboard') {
    if (r.edit) q.set('edit', '1');
    if (r.tile) {
      q.set('tile', r.tile);
      q.set('detail', '1');
      if (r.tile === 'what-loop-did') {
        if (r.mode !== 'hours') q.set('mode', r.mode);
        q.set('sel', String(r.sel));
      }
    }
  }
  if (r.view === 'review') {
    q.set('patient', r.patient);
    if (r.section !== 'glucose') q.set('section', r.section);
  }
  return `?${q.toString()}`;
}

export type Go = (patch: Partial<Route>, opts?: { replace?: boolean }) => void;
