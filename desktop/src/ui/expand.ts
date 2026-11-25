// The tile → detail transform (design pass, Nov 23): the tile you press becomes
// the detail's main panel, one shared element through the View Transitions API,
// so the eye never loses the number it clicked. The dashboard recedes, the
// detail's other content arrives after the panel lands, Back reverses into the
// same tile. Timings live in app.css (::view-transition-*); reduced motion gets
// a short crossfade with no movement. Without View Transitions it just navigates.
//
// Fuzzy load (board consensus, Nov 24: "ghost of the real shape"): while the panel
// grows, what fills it is the tile's own picture, stretched and blurred mid-flight,
// focusing into the detail as it lands. Nothing appears the tile didn't already
// show. The tile's headline number travels on its own (ls-num), crisp the whole
// way, and only when the detail shows the very same number.
import { flushSync } from 'react-dom';

type Vt = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition: () => void };
type VtDoc = Document & { startViewTransition?: (cb: () => void) => Vt };
const HERO = 'ls-hero';
const NUM = 'ls-num';
/** A tile's headline number, on dashboard tiles, the Glance, and in details. */
const NUM_SEL = '.big-num, .cgm-value .num, .gl-big, .gl-now-num, .gl-ring-num';
/** The element a detail was opened from, so Back can land in the same place. */
let openedFrom: string | null = null;
/** Where the dashboard was scrolled when the detail opened, so Back returns there. */
let dashScroll = 0;
/** The transition running now: a second press skips it instead of fighting it. */
let active: Vt | null = null;
/** Bones → full data (Nov 24): the detail draws in its real layout from the first frame, as
 *  low-fidelity shapes (app.css, "ls-bones"): text as bars the width of each line, charts as soft
 *  blocks, colour greyed. The transition's picture of the detail is live, so the bones are what
 *  grows inside the panel. Once it lands they fill in ("ls-reveal"). Nothing moves when they do:
 *  the bones are the real layout. Reduced motion skips straight to the data. */
let bonesTimer = 0;
/** How long the bones stay once the panel has landed, before the data fills in. */
const BONES_HOLD_MS = 260;
const rootCls = () => document.documentElement.classList;
function bones(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !(document as VtDoc).startViewTransition) return;
  rootCls().remove('ls-reveal');
  rootCls().add('ls-bones');
  clearTimeout(bonesTimer);
  // If the transition never finishes (a hidden window, a skipped run), the data still arrives.
  bonesTimer = window.setTimeout(reveal, 1500);
}
function reveal(): void {
  clearTimeout(bonesTimer);
  if (!rootCls().contains('ls-bones')) return;
  rootCls().remove('ls-bones');
  rootCls().add('ls-reveal');
  bonesTimer = window.setTimeout(() => rootCls().remove('ls-reveal'), 600);
}
function clearBones(): void { clearTimeout(bonesTimer); rootCls().remove('ls-bones', 'ls-reveal'); }

const scroller = () => document.getElementById('main');
/** Move focus without scrolling the view the transition is drawing. */
const focusQuiet = (el: Element | null) => { (el as HTMLElement | null)?.focus?.({ preventScroll: true }); };
/** The digits a number shows, so "87%" in a tile and "87 %" in a panel count as the same number. */
const digitsOf = (el: Element | null) => {
  if (!el) return '';
  // What's drawn, not the screen-reader copy beside it (Num renders both).
  let t = el.textContent ?? '';
  el.querySelectorAll('.sr-only').forEach((s) => { t = t.replace(s.textContent ?? '', ''); });
  return t.replace(/[^\d.,]/g, '');
};
const named = (el: Element | null, name: string) => { if (el) (el as HTMLElement).style.viewTransitionName = name; };
/** The headline number in `scope` that shows exactly `digits`, or null. Never pairs two different numbers. */
function sameNumber(scope: ParentNode | null, digits: string): HTMLElement | null {
  if (!scope || !digits) return null;
  return [...scope.querySelectorAll<HTMLElement>(NUM_SEL)].find((n) => digitsOf(n) === digits && n.getClientRects().length > 0) ?? null;
}

function run(update: () => void, before: () => void, after: () => void, done: () => void, back: boolean): void {
  const doc = document as VtDoc;
  if (!doc.startViewTransition) { update(); after(); done(); return; }
  active?.skipTransition();
  const root = document.documentElement;
  before();
  root.classList.add('ls-vt');
  root.classList.toggle('ls-vt-back', back);
  try {
    const t = doc.startViewTransition(() => { flushSync(update); after(); });
    active = t;
    // A skipped transition rejects these; skipping is expected when a second press arrives.
    t.ready.catch(() => undefined);
    t.updateCallbackDone.catch(() => undefined);
    t.finished.catch(() => undefined).finally(() => {
      if (active !== t) return; // a newer transition owns the classes now
      active = null;
      root.classList.remove('ls-vt', 'ls-vt-back');
      done();
    });
  } catch {
    root.classList.remove('ls-vt', 'ls-vt-back');
    update(); after(); done();
  }
}

/** Open a detail from `el` (a Glance tile, or a dashboard tile). `selector` finds that element again for Back. */
export function expandFrom(el: Element | null, selector: string, update: () => void): void {
  openedFrom = selector;
  const node = el as HTMLElement | null;
  dashScroll = scroller()?.scrollTop ?? 0;
  const tileNum = node?.querySelector<HTMLElement>(NUM_SEL) ?? null;
  const digits = digitsOf(tileNum);
  let panelNum: HTMLElement | null = null;
  run(update,
    () => {
      named(node, HERO); named(tileNum, NUM);
      bones();
    },
    () => {
      named(node, '');
      named(tileNum, '');
      // The detail opens at its top, whatever the dashboard's scroll was.
      const sc = scroller(); if (sc) sc.scrollTop = 0;
      panelNum = sameNumber(document.querySelector('.detail-page .detail-grid > :first-child'), digits);
      named(panelNum, NUM);
    },
    // Focus goes to the way back once the panel has landed, so keyboard and VoiceOver users keep their place.
    () => {
      named(panelNum, '');
      // The bones hold a beat after the panel lands, so the eye registers the layout, then the data snaps in.
      clearTimeout(bonesTimer);
      bonesTimer = window.setTimeout(reveal, BONES_HOLD_MS);
      focusQuiet(document.querySelector('.detail-page .back-btn'));
    },
    false);
}

/** Back to the dashboard, shrinking the panel into the tile it came from, at the scroll it was left at. */
export function collapseTo(update: () => void): void {
  clearBones();
  const sel = openedFrom;
  let target: HTMLElement | null = null;
  let tileNum: HTMLElement | null = null;
  const panelNum = document.querySelector<HTMLElement>('.detail-page .detail-grid > :first-child')?.querySelector<HTMLElement>(NUM_SEL) ?? null;
  const digits = digitsOf(panelNum);
  run(update, () => named(panelNum, NUM), () => {
    const sc = scroller(); if (sc) sc.scrollTop = dashScroll;
    target = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    named(target, HERO);
    tileNum = sameNumber(target, digits);
    named(tileNum, NUM);
  }, () => {
    named(target, '');
    named(tileNum, '');
    // Back on the tile (or its Details button) you opened, looked up again: React may have redrawn it.
    const now = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    focusQuiet(now?.matches('button') ? now : now?.querySelector('.detail-btn') ?? now);
  }, true);
}
