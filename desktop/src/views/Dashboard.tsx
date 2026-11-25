// "My dashboard": the person's own 12-column canvas of tracker tiles (PROD-1).
// Edit layout switches to the arrange view: the same grid scaled back to about
// half size, each tile a live miniature, so the whole dashboard fits on screen
// and a drag moves a small block rather than the full UI. The tile library sits
// beside it. Every pointer move has a keyboard twin, and every change is announced.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import {
  applyKey, available, canRemove, describe, indexOf, moveBy, moveTo, PRESET_IDS, PRESETS, remove, resize, stepHeight,
  TILES, WIDTH_NAME, WIDTHS, add, MAX_H, has, clampW, clampH, type Width, type Layout, type PresetId, type Tile, type TileKind,
} from '../layout/model';
import type { Go, Route } from '../nav';
import { FACES } from '../tiles/faces';
import { dropTarget, type Placed } from '../layout/dropTarget';
import { Glance } from '../ui/Glance';
import { collapseTo, expandFrom } from '../ui/expand';
import { onPeriodLoading, periodLoading } from '../data/source';
import { mostOpened } from '../data/tileOpens';
import './arrange.css';
import { IBack, IChevron, IClose, IGrip, IMore, IPin, IPlus, IResize, Menu, useAnnounce, type MenuItem } from '../ui/kit';

/** Width choices in the tile menu, in words: a quarter, half, two thirds or all of the row. */
const WIDTH_WORD: Record<number, string> = { 4: 'Small', 6: 'Medium', 8: 'Large', 12: 'Full width' };
const WIDTH_LABEL: Record<number, string> = { 4: 'Small · a third', 6: 'Medium · half', 8: 'Large · two thirds', 12: 'Full width' };

const ROW_H = 150;
const GAP = 16;
// The arrange view: about half size, so the whole layout is in view.
const ARRANGE_ROW_H = 84;
const ARRANGE_GAP = 10;

interface Props {
  route: Route;
  go: Go;
  layout: Layout;
  setLayout: (l: Layout) => void;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  /** Saved layouts and appearance live behind Edit layout, not in the top bar. */
  layouts: SavedLayouts;
}

/** Window listeners for one drag; returns the way to take them off again. Keydown listens in the capture phase, so Esc reaches the drag first. */
function listen(handlers: { [K in keyof WindowEventMap]?: (e: WindowEventMap[K]) => void }): () => void {
  const entries = Object.entries(handlers) as [string, EventListener][];
  for (const [type, fn] of entries) window.addEventListener(type, fn, type === 'keydown');
  return () => { for (const [type, fn] of entries) window.removeEventListener(type, fn, type === 'keydown'); };
}

export interface SavedLayouts { active: string | null; dirty: boolean; count: number; open: boolean; onToggle: () => void; /** Remember the dashboard before a change, so it can be undone in one step. */ checkpoint: (label: string) => void }

export function Dashboard(props: Props) {
  const { route, go } = props;
  if (route.tile) return <DetailPage route={route} go={go} kind={route.tile} />;
  return <Canvas {...props} />;
}

function DetailPage({ route, go, kind }: { route: Route; go: Go; kind: TileKind }) {
  const { Detail } = FACES[kind];
  return (
    <div className="detail-page">
      <div className="row detail-head">
        <button type="button" className="back-btn" onClick={() => collapseTo(() => go({ tile: null }))}>
          <IBack /> My dashboard
        </button>
        {TILES[kind].pinned && <span className="pin-note"><IPin /> Always on your dashboard</span>}
      </div>
      <Detail route={route} go={go} w={12} h={4} />
    </div>
  );
}

function Canvas({ route, go, layout, setLayout, onPreset, onReset, layouts }: Props) {
  const announce = useAnnounce();
  // While a new period builds, the tiles soften behind a skeleton and say what's being read.
  const loading = useSyncExternalStore(onPeriodLoading, periodLoading);
  const grid = useRef<HTMLDivElement>(null);
  const edit = route.edit;
  const rowH = edit ? ARRANGE_ROW_H : ROW_H;
  const gap = edit ? ARRANGE_GAP : GAP;

  const commit = (next: Layout, msg: string | null) => {
    if (next === layout) return;
    setLayout(next);
    if (msg) announce(msg);
  };

  /** Move focus to a tile once React has drawn it, and bring it into view. */
  const focusTile = (id: TileKind) => requestAnimationFrame(() => {
    const el = grid.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  /** Remove a tile with one step of undo, then hand focus to its neighbour. */
  const removeTile = (id: TileKind) => {
    const next = remove(layout, id);
    if (next === layout) return;
    const msg = `${TILES[id].title} removed.`;
    layouts.checkpoint(msg);
    commit(next, `${msg} Undo is available, or add it back from the library.`);
    const i = Math.min(indexOf(layout, id), next.tiles.length - 1);
    if (i >= 0) focusTile(next.tiles[i].id);
  };

  // ---------------------------------------------------------- drag to move (pointer)
  // The board's call (Nov 24): press anywhere on a tile and pull past 4px. The tile
  // lifts into a ghost that follows the pointer from where you grabbed it; its place
  // becomes a dashed slot of the same size; neighbours slide (FLIP) only once the
  // pointer is past a tile's middle (dropTarget.ts). Esc puts everything back; a
  // drop is one change, so Undo takes it back in one step. Tiles drag in from the
  // library the same way.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const propsRef = useRef({ checkpoint: layouts.checkpoint, setLayout, announce });
  propsRef.current = { checkpoint: layouts.checkpoint, setLayout, announce };
  const [preview, setPreviewState] = useState<Layout | null>(null);
  const previewRef = useRef<Layout | null>(null);
  const setPreview = (l: Layout | null) => { previewRef.current = l; setPreviewState(l); };
  const shown = preview ?? layout;
  const ghost = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: TileKind; title: string; pointer: number; sx: number; sy: number; ox: number; oy: number; w: number; h: number;
    x: number; y: number; started: boolean; fromLibrary: boolean; displaced: TileKind | null;
    /** Takes off the window listeners this drag put on (the same functions, whatever React has redrawn since). */
    off: () => void;
  } | null>(null);
  const [ghostOf, setGhostOf] = useState<{ id: TileKind; w: number; h: number } | null>(null);

  // FLIP: remember where each tile was drawn, then slide it from there once React has redrawn.
  const before = useRef<Map<string, DOMRect> | null>(null);
  const snapshot = (extra?: [string, DOMRect]) => {
    const m = new Map<string, DOMRect>();
    grid.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => m.set(el.dataset.tile!, el.getBoundingClientRect()));
    if (extra) m.set(extra[0], extra[1]);
    before.current = m;
  };
  useLayoutEffect(() => {
    const b = before.current;
    before.current = null;
    if (!b || !grid.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    grid.current.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
      const was = b.get(el.dataset.tile!);
      if (!was) return;
      el.getAnimations().forEach((a) => a.cancel());
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0, 1)' });
    });
  }, [shown, ghostOf]);

  const placeGhost = () => {
    const d = drag.current;
    if (d && ghost.current) ghost.current.style.transform = `translate3d(${d.x - d.ox}px, ${d.y - d.oy}px, 0)`;
  };
  useLayoutEffect(placeGhost, [ghostOf]);

  /** Re-read where the pointer is and move the slot if it crossed a tile's middle. */
  const retarget = () => {
    const d = drag.current, g = grid.current;
    if (!d?.started || !g) return;
    const gr = g.getBoundingClientRect();
    const x = d.x - gr.left, y = d.y - gr.top;
    const cur = previewRef.current;
    if (d.fromLibrary && (x < 0 || x > gr.width + 8)) {
      // Back over the library: the slot leaves, and letting go adds nothing.
      if (cur) { snapshot(); setPreview(null); }
      return;
    }
    const on = cur ?? layoutRef.current;
    const tiles: Placed[] = on.tiles.flatMap((t) => {
      const el = g.querySelector<HTMLElement>(`[data-tile="${t.id}"]`);
      return el ? [{ id: t.id, box: { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight } }] : [];
    });
    if (d.displaced) {
      const p = tiles.find((t) => t.id === d.displaced);
      if (!p || x < p.box.left || x > p.box.right || y < p.box.top || y > p.box.bottom) d.displaced = null;
    }
    const hit = dropTarget({ tiles: cur ? tiles : tiles.filter((t) => t.id !== d.id), id: d.id, x, y, displaced: d.displaced });
    if (!hit) return;
    const next = cur && has(cur, d.id) ? moveTo(cur, d.id, hit.index) : add(layoutRef.current, d.id, hit.index);
    if (next === cur) return;
    d.displaced = hit.over;
    snapshot();
    setPreview(next);
  };

  // Near the top or bottom of the window, the dashboard scrolls under the dragged tile.
  const autoScroll = () => {
    const d = drag.current, main = document.getElementById('main');
    if (!d?.started || !main) return;
    const r = main.getBoundingClientRect(), edge = 72;
    const v = d.y < r.top + edge ? -((r.top + edge - d.y) / edge) * 16 : d.y > r.bottom - edge ? ((d.y - (r.bottom - edge)) / edge) * 16 : 0;
    if (v) { main.scrollTop += v; retarget(); }
    requestAnimationFrame(autoScroll);
  };

  const endDrag = (how: 'drop' | 'cancel') => {
    const d = drag.current;
    d?.off();
    drag.current = null;
    if (!d?.started) return;
    document.documentElement.classList.remove('ls-dragging');
    // A drag that ends on a library row isn't also a click on it.
    const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    const final = previewRef.current;
    const { checkpoint, setLayout: set, announce: say } = propsRef.current;
    // The tile settles from where the ghost was into its slot.
    snapshot(ghost.current ? [d.id, ghost.current.getBoundingClientRect()] : undefined);
    setPreview(null);
    setGhostOf(null);
    if (how === 'cancel') { say(`${d.title}: move cancelled.`); return; }
    const before0 = layoutRef.current;
    const changed = final && final.tiles.map((t) => t.id).join() !== before0.tiles.map((t) => t.id).join();
    if (!final || !changed) { say(d.fromLibrary ? `${d.title} not added.` : describe(before0, d.id)); return; }
    checkpoint(d.fromLibrary ? `${d.title} added.` : `${d.title} moved.`);
    set(final);
    say(`${d.fromLibrary ? 'Added. ' : ''}${describe(final, d.id)}.`);
    focusTile(d.id);
  };
  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.started) {
      if (Math.hypot(d.x - d.sx, d.y - d.sy) < 4) return;
      d.started = true;
      document.documentElement.classList.add('ls-dragging');
      setGhostOf({ id: d.id, w: d.w, h: d.h });
      if (!d.fromLibrary) setPreview(layoutRef.current);
      propsRef.current.announce(`Picked up ${d.title}. Esc cancels.`);
      requestAnimationFrame(autoScroll);
    }
    placeGhost();
    retarget();
  }
  function onUp(e: PointerEvent) { if (drag.current?.pointer === e.pointerId) endDrag('drop'); }
  function onCancel(e: PointerEvent) { if (drag.current?.pointer === e.pointerId) endDrag('cancel'); }
  function onKey(e: globalThis.KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Esc during a drag cancels the drag, not the whole edit.
    e.preventDefault(); e.stopPropagation();
    if (drag.current) endDrag('cancel');
    if (rs.current) endResize(false);
  }

  const beginDrag = (e: RPointerEvent<HTMLElement>, id: TileKind, fromLibrary: boolean) => {
    if (e.button !== 0 || drag.current || rs.current || !grid.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (fromLibrary) {
      // The ghost is the size the tile will take on the grid.
      const col = (grid.current.clientWidth - gap * 11) / 12;
      w = TILES[id].w * col + (TILES[id].w - 1) * gap;
      h = TILES[id].h * rowH + (TILES[id].h - 1) * gap;
    }
    drag.current = {
      id, title: TILES[id].title, pointer: e.pointerId, sx: e.clientX, sy: e.clientY,
      ox: Math.min(e.clientX - r.left, w - 24), oy: fromLibrary ? 18 : Math.min(e.clientY - r.top, h - 12),
      w, h, x: e.clientX, y: e.clientY, started: false, fromLibrary, displaced: null,
      off: listen({ pointermove: onMove, pointerup: onUp, pointercancel: onCancel, keydown: onKey }),
    };
  };
  const onTileDown = (id: TileKind) => (e: RPointerEvent<HTMLElement>) => {
    // The ⋯ menu and the resize corner keep their own presses.
    if ((e.target as HTMLElement).closest('button:not(.handle), [role="menu"], .resize-handle')) return;
    beginDrag(e, id, false);
  };

  // ---------------------------------------------------------- drag to resize (pointer)
  // A snapped outline with its size in words shows where the corner will land; the
  // grid doesn't reflow until you let go, so nothing jumps while you size it.
  const rs = useRef<{ id: TileKind; title: string; x: number; y: number; w: number; h: number; col: number; pointer: number; to: { w: Width; h: number }; off: () => void } | null>(null);
  const [sizing, setSizing] = useState<{ id: TileKind; w: Width; h: number; col: number } | null>(null);
  const endResize = (apply: boolean) => {
    const s = rs.current;
    s?.off();
    rs.current = null;
    setSizing(null);
    document.documentElement.classList.remove('ls-resizing');
    if (!s) return;
    const { checkpoint, setLayout: set, announce: say } = propsRef.current;
    const l = layoutRef.current;
    const next = apply ? resize(l, s.id, s.to) : l;
    if (next === l) { say(apply ? describe(l, s.id) : `${s.title}: resize cancelled.`); return; }
    checkpoint(`${s.title} resized.`);
    snapshot();
    set(next);
    say(describe(next, s.id));
  };
  function onResizeMove(e: PointerEvent) {
    const s = rs.current;
    if (!s || s.pointer !== e.pointerId) return;
    const to = { w: clampW(s.id, Math.round((s.w + (e.clientX - s.x) + gap) / (s.col + gap))), h: clampH(s.id, Math.round((s.h + (e.clientY - s.y) + gap) / (rowH + gap))) };
    if (to.w === s.to.w && to.h === s.to.h) return;
    s.to = to;
    setSizing({ id: s.id, ...to, col: s.col });
  }
  function onResizeUp(e: PointerEvent) { if (rs.current?.pointer === e.pointerId) endResize(true); }
  function onResizeCancel(e: PointerEvent) { if (rs.current?.pointer === e.pointerId) endResize(false); }
  const onResizeDown = (t: Tile) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !grid.current || drag.current || rs.current) return;
    e.preventDefault();
    const el = e.currentTarget.closest<HTMLElement>('[data-tile]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const col = (grid.current.clientWidth - gap * 11) / 12;
    rs.current = {
      id: t.id, title: TILES[t.id].title, x: e.clientX, y: e.clientY, w: r.width, h: r.height, col, pointer: e.pointerId, to: { w: t.w, h: t.h },
      off: listen({ pointermove: onResizeMove, pointerup: onResizeUp, pointercancel: onResizeCancel, keydown: onKey }),
    };
    setSizing({ id: t.id, w: t.w, h: t.h, col });
    document.documentElement.classList.add('ls-resizing');
  };

  useEffect(() => {
    // Switching apps mid-drag puts the tile back rather than dropping it somewhere unseen.
    const cancel = () => { if (drag.current) endDrag('cancel'); if (rs.current) endResize(false); };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  });

  // ---------------------------------------------------------- keyboard
  const onTileKey = (id: TileKind) => (e: KeyboardEvent<HTMLElement>) => {
    if (!edit || e.target !== e.currentTarget) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(e.key)) return;
    e.preventDefault();
    if ((e.key === 'Delete' || e.key === 'Backspace') && canRemove(id)) { removeTile(id); return; }
    const { layout: next, message } = applyKey(layout, id, e.key, e.shiftKey);
    if (message) announce(message);
    if (next !== layout) setLayout(next);
    if (!next.tiles.some((t) => t.id === id)) {
      // The removed tile's neighbour takes focus once React has drawn the new layout.
      const i = Math.min(indexOf(layout, id), next.tiles.length - 1);
      requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-tile="${next.tiles[i].id}"]`)?.focus());
    }
  };

  const menuFor = (t: Tile, i: number) => {
    const last = layout.tiles.length - 1;
    const steps = WIDTHS.filter((w) => w >= TILES[t.id].minW);
    const items: MenuItem[] = [
      { label: 'Move earlier', hint: '←', disabled: i === 0, onSelect: () => commitAndDescribe(moveBy(layout, t.id, -1), t.id) },
      { label: 'Move later', hint: '→', disabled: i === last, onSelect: () => commitAndDescribe(moveBy(layout, t.id, 1), t.id) },
    ];
    const widths: MenuItem[] = steps.map((w, k) => ({
      label: WIDTH_LABEL[w],
      checked: t.w === w,
      divide: k === 0,
      onSelect: () => commitAndDescribe(resize(layout, t.id, { w }), t.id),
    }));
    const heights: MenuItem[] = [
      { label: 'Taller', hint: '⇧↓', divide: true, disabled: t.h >= MAX_H, onSelect: () => commitAndDescribe(stepHeight(layout, t.id, 1), t.id) },
      { label: 'Shorter', hint: '⇧↑', disabled: t.h <= TILES[t.id].minH, onSelect: () => commitAndDescribe(stepHeight(layout, t.id, -1), t.id) },
    ];
    const all: MenuItem[] = [...items, ...widths, ...heights];
    if (canRemove(t.id)) all.push({ label: 'Remove', hint: 'Del', divide: true, onSelect: () => removeTile(t.id) });
    return all;
  };

  // Menu items announce the resulting position once they've applied.
  const commitAndDescribe = (next: Layout, id: TileKind) => commit(next, next.tiles.some((t) => t.id === id) ? describe(next, id) : null);

  if (!edit) {
    return (
      <div className="dash">
        <div className="canvas-wrap">
          <Glance go={go} />
          {loading && <p className="period-loading" role="status">Reading the last {loading} days…</p>}
          <div ref={grid} className={`canvas${loading ? ' loading' : ''}`} aria-busy={loading ? true : undefined} style={{ ['--row-h' as string]: `${ROW_H}px`, ['--gap' as string]: `${GAP}px` }}>
            {layout.tiles.map((t) => {
              const spec = TILES[t.id];
              const { Glance } = FACES[t.id];
              const titleId = `tile-${t.id}-title`;
              return (
                <article key={t.id} data-tile={t.id} className="tile" style={{ gridColumn: `span ${t.w}`, gridRow: `span ${t.h}` }} aria-labelledby={titleId}>
                  <header className="tile-head">
                    <h2 id={titleId} className="tile-title">{spec.title}</h2>
                    <button type="button" className="text-btn detail-btn" aria-label={`Open ${spec.title} details`} onClick={(e) => expandFrom(e.currentTarget.closest('article'), `article[data-tile="${t.id}"]`, () => go({ tile: t.id }))}>
                      Details <IChevron />
                    </button>
                  </header>
                  <div className="tile-body"><Glance route={route} go={go} w={t.w} h={t.h} /></div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash editing">
      <div className="canvas-wrap">
        <div className="arrange-bar">
          <p className="edit-hint" id="edit-hint">
            Drag a tile anywhere to move it, or pull its corner to resize. Esc cancels a drag. Keyboard: arrows move, Shift and arrows resize, Delete removes.
          </p>
        </div>
        <div ref={grid} className={`canvas arrange-grid${ghostOf ? ' is-dragging' : ''}${sizing ? ' is-sizing' : ''}`} style={{ ['--row-h' as string]: `${rowH}px`, ['--gap' as string]: `${gap}px` }}
          onKeyDown={(e) => {
            // Esc leaves edit mode (a menu's own Esc stops before it gets here) and returns focus to Edit layout.
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            go({ edit: false }, { replace: true });
            announce('Finished editing the layout.');
            requestAnimationFrame(() => document.getElementById('edit-toggle')?.focus());
          }}>
          {shown.tiles.map((t, i) => {
            const spec = TILES[t.id];
            const titleId = `tile-${t.id}-title`;
            const slot = ghostOf?.id === t.id;
            const sz = sizing?.id === t.id ? sizing : null;
            return (
              <article
                key={t.id}
                data-tile={t.id}
                className={`tile arrange${slot ? ' slot' : ''}${sz ? ' resizing' : ''}`}
                style={{ gridColumn: `span ${t.w}`, gridRow: `span ${t.h}` }}
                aria-labelledby={titleId}
                aria-describedby={i === 0 ? 'edit-hint' : undefined}
                tabIndex={0}
                onKeyDown={onTileKey(t.id)}
                onPointerDown={onTileDown(t.id)}
              >
                <header className="tile-head">
                  <button type="button" className="icon-btn handle" tabIndex={-1} aria-hidden="true" title={`Drag to move ${spec.title}`}>
                    <IGrip />
                  </button>
                  <h2 id={titleId} className="tile-title">{spec.title}</h2>
                  {spec.pinned && <span className="pin-note" title="Always on your dashboard"><IPin /><span className="sr-only">Always on your dashboard</span></span>}
                  <span className="size-chip" aria-label={`${WIDTH_NAME[t.w]} width, ${t.h} ${t.h === 1 ? 'row' : 'rows'} tall`}>{WIDTH_WORD[t.w]}</span>
                  <Menu
                    label={`Options for ${spec.title}`}
                    items={menuFor(t, i)}
                    note={spec.pinned ? 'Always on your dashboard. Move or resize it; it can’t be removed.' : undefined}
                  >
                    <IMore />
                  </Menu>
                </header>
                {/* What the tile holds, in words: a half-size live glance was too small to read and cost a full render per tile. */}
                <div className="tile-preview summary" aria-hidden="true">
                  <p className="small">{spec.blurb}</p>
                </div>
                {sz && (
                  <div className="resize-ghost" aria-hidden="true" style={{ width: sz.w * sz.col + (sz.w - 1) * gap, height: sz.h * rowH + (sz.h - 1) * gap }}>
                    <span className="resize-label">{WIDTH_WORD[sz.w]} · {sz.h} {sz.h === 1 ? 'row' : 'rows'}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="icon-btn resize-handle"
                  tabIndex={-1}
                  aria-hidden="true"
                  title={`Drag to resize ${spec.title}`}
                  onPointerDown={onResizeDown(t)}
                >
                  <IResize />
                </button>
              </article>
            );
          })}
        </div>
      </div>
      {ghostOf && (
        <div ref={ghost} className="drag-ghost" aria-hidden="true" style={{ width: ghostOf.w, height: ghostOf.h }}>
          <div className="drag-ghost-card">
            <div className="tile-head"><IGrip /><span className="tile-title">{TILES[ghostOf.id].title}</span></div>
            <p className="small">{TILES[ghostOf.id].blurb}</p>
          </div>
        </div>
      )}
      <Library layout={layout} onAdd={(k) => { const next = add(layout, k); commit(next, `${TILES[k].title} added at the end. ${describe(next, k)}.`); focusTile(k); }} onPreset={onPreset} onReset={onReset} layouts={layouts} onClose={() => go({ edit: false })} onDragStart={(k, e) => beginDrag(e, k, true)} />
    </div>
  );
}

function Library({ layout, onAdd, onPreset, onReset, layouts, onClose, onDragStart }: {
  layout: Layout;
  /** Press and pull a row to drop the tile into a place on the grid; a plain click still adds it at the end. */
  onDragStart: (k: TileKind, e: RPointerEvent<HTMLElement>) => void;
  layouts: SavedLayouts;
  onAdd: (k: TileKind) => void;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const left = available(layout);
  const opened = mostOpened();
  const on = layout.tiles.filter((t) => !TILES[t.id].pinned);
  return (
    <aside className="tile-library" aria-label="Tile library">
      <div className="row between">
        <h2 className="h3">Tiles</h2>
        <button type="button" className="icon-btn" aria-label="Finish editing the layout" onClick={onClose}><IClose /></button>
      </div>

      <section aria-labelledby="lib-add" className="stack-8">
        <h3 id="lib-add" className="label">Add a tile</h3>
        <p className="caption">Drag one into place, or click to add it at the end.</p>
        {left.length === 0 && <p className="caption">Every tile is on your dashboard.</p>}
        {left.map((k) => (
          <button key={k} type="button" className="lib-row draggable" onClick={() => onAdd(k)} onPointerDown={(e) => onDragStart(k, e)} aria-label={`Add ${TILES[k].title}`} title="Click to add at the end, or drag it into place">
            <span className="stack">
              <span className="strong">{TILES[k].title}</span>
              <span className="caption">{TILES[k].blurb}</span>
            </span>
            <IPlus />
          </button>
        ))}
      </section>



      <section aria-labelledby="lib-presets" className="stack-8">
        <h3 id="lib-presets" className="label">Start from a preset</h3>
        {PRESET_IDS.map((p) => (
          <button key={p} type="button" className="lib-row" aria-pressed={layout.preset === p} onClick={() => onPreset(p)}>
            <span className="stack">
              <span className="strong">{PRESETS[p].name}</span>
              <span className="caption">{PRESETS[p].blurb}</span>
            </span>
          </button>
        ))}
        <button type="button" className="quiet-btn" onClick={onReset}>Reset to default</button>
      </section>

      <section aria-labelledby="lib-saved" className="stack-8">
        <h3 id="lib-saved" className="label">Saved layouts</h3>
        <button type="button" id="lib-saved-row" className="lib-row" aria-expanded={layouts.open} aria-controls="layout-controls" onClick={layouts.onToggle}>
          <span className="stack">
            <span className="strong">{layouts.active ?? 'Working view'}{layouts.dirty && <span className="caption"> · unsaved changes</span>}</span>
            <span className="caption">{layouts.count ? `${layouts.count} saved` : 'None saved yet'} · save, switch or rename · appearance</span>
          </span>
          <span className="caption">{layouts.open ? 'Showing' : 'Show'}</span>
        </button>
      </section>



      <section aria-labelledby="lib-on" className="stack-8">
        <h3 id="lib-on" className="label">Always on your dashboard</h3>
        {(['heads-ups', 'day-tracker'] as const).map((k) => (
          <div key={k} className="lib-row static">
            <span className="stack">
              <span className="strong">{TILES[k].title}</span>
              <span className="caption">Move or resize it; it stays on every layout.</span>
            </span>
            <IPin />
          </div>
        ))}
        {opened.length > 0 && <p className="caption">Opened most in the last 30 days: {opened.slice(0, 3).map((o) => `${TILES[o.kind].title} (${o.n})`).join(', ')}.</p>}
        <p className="caption">{on.length} more {on.length === 1 ? 'tile' : 'tiles'} on your dashboard. Remove one from its ⋯ menu or with Delete; Undo brings it back.</p>
      </section>
    </aside>
  );
}
