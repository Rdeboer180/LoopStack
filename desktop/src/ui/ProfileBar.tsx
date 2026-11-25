// The sidebar's foot: who you are and where settings live, the way chat apps
// put the account at the bottom left. Avatar (with Loop's status ring, DM-3),
// name · data source, a chevron that opens a short menu, and a gear for
// Settings. On the care-team view it shows who is reading instead. The
// not-affiliated note (BRAND-2) sits at the foot of the account menu and in
// Settings > About, not in the sidebar.
import { useEffect, useRef, useState } from 'react';
import { DATA, PATIENT } from '../data/current';
import { showSample } from '../data/source';
import type { Go } from '../nav';
import { useAnnounce } from './kit';

/** A gear, for Settings. */
const IGear = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
import './profile.css';

/** Loop's freshness colour: green under 5 minutes, yellow to 15, red after (paired with words in the menu, COL-5). */
const ringColour = (min: number) => (min < 5 ? 'var(--brand-primary)' : min <= 15 ? 'var(--range-high)' : 'var(--range-low)');

export function ProfileBar({ clinician, go }: { clinician: boolean; go: Go }) {
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { setOpen(false); return; }
      if (!wrap.current?.contains(e.target as Node)) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  // Short, so the name keeps the room: Live is your Nightscout, Sample the made-up patient.
  const source = DATA.source === 'synthetic' ? 'Sample' : 'Live';
  const name = clinician ? PATIENT.clinician : PATIENT.name;
  const initials = clinician ? PATIENT.clinician.split(/\s+/).map((w) => w[0]).filter((c) => /[A-Z]/i.test(c)).slice(-2).join('').toUpperCase() : PATIENT.initials;
  const sub = clinician ? 'Care team' : source;
  const looped = PATIENT.loopedMinAgo;

  return (
    <div className="profile" ref={wrap}>
      <div className="profile-row">
        <button
          ref={trigger}
          type="button"
          className="profile-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'profile-menu' : undefined}
          aria-label={`${name}, ${sub}${clinician ? '' : `, looped ${looped} minutes ago`}. Account menu`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="profile-avatar" style={{ boxShadow: clinician ? undefined : `0 0 0 2px var(--surface-0), 0 0 0 4px ${ringColour(looped)}` }} aria-hidden="true">{initials}</span>
          <span className="profile-name">{name}</span>
          <svg className="profile-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="icon-btn profile-gear" aria-label="Settings" title="Settings" onClick={() => go({ view: 'settings' })}>
          <IGear />
        </button>
      </div>
      {open && (
        <div id="profile-menu" ref={menu} role="menu" aria-label="Account" className="profile-menu glass">
          <div className="profile-menu-head">
            <span className="strong">{PATIENT.name}</span>
            <span className="caption">{clinician ? `Reading as ${PATIENT.clinician}` : `Looped ${looped} min ago · ${DATA.sourceLabel}`}</span>
          </div>
          <button type="button" role="menuitem" onClick={pick(() => go({ view: 'settings' }))}>Your data<span className="caption">Nightscout</span></button>
          <button type="button" role="menuitem" onClick={pick(() => go({ view: 'settings' }))}>Your Loop<span className="caption">GitHub build</span></button>
          <button type="button" role="menuitem" onClick={pick(() => go({ view: 'settings' }))}>AI connector<span className="caption">Your key</span></button>
          <div className="profile-menu-sep" role="separator" />
          {clinician
            ? <button type="button" role="menuitem" onClick={pick(() => go({ view: 'dashboard' }))}>Back to my dashboard</button>
            : <button type="button" role="menuitem" onClick={pick(() => go({ view: 'review', section: 'glucose' }))}>See it as your care team does</button>}
          {DATA.source === 'nightscout' && (
            <button type="button" role="menuitem" onClick={pick(() => { showSample(); announce('Showing the sample patient.'); })}>Show the sample patient</button>
          )}
          <div className="profile-menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={pick(() => go({ view: 'settings' }))}>Settings</button>
          <button type="button" role="menuitem" onClick={pick(() => go({ view: 'settings' }))}>About LoopStack</button>
          <p className="caption profile-menu-foot">Independent · not affiliated with LoopKit, Tidepool, Dexcom or Insulet · never changes your pump · changes to Loop only through your own reviewed build.</p>
        </div>
      )}
    </div>
  );
}
