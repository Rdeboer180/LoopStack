// Suggestions (PRODUCT.md SAFE-5a): what LoopStack's own readings point at,
// for therapy settings and favorite foods. Track one to watch it build
// confidence; once it's Readable, within a 20% step and not a safety limit,
// it can go into your next build, where it arrives in Loop as a proposal you
// confirm. The Ready list exports a Claude-ready brief or opens Build in
// Ask & build. Copy states readings, never instructions (SAFE-1).
import { useEffect, useMemo, useState } from 'react';
import { DATA, MEALS, SUGGESTIONS } from '../data/current';
import { CONFIDENCE_LABEL, eligibleForBuild, fmtValue, foodId, readingLine, stepOf, type Suggestion } from '../data/suggestions';
import { badgeNow, markSuggestionsSeen, toPortable, useTracked, type Tracked } from '../data/tracked';
import { encodeTransfer, parseTransfer } from '@/lib/tracking/transfer';
import { openNextBuild } from '../data/intent';
import { nextBuildBridge, briefFor } from '../data/nextBuild';
import type { Go } from '../nav';
import { ICheck, IChevron, IPlus, Segmented, useAnnounce } from '../ui/kit';

/** The confidence grade as the shared flag family: Readable green, Caveated amber, not enough data muted. */
const CONF_FLAG = { good: 'on', limited: 'dose', unusable: 'muted' } as const;

type Tab = 'building' | 'ready';

/** The badge counts as they were when the view opened, before it marks everything seen. */
const badgeSnapshot = () => badgeNow(SUGGESTIONS.map((s) => ({ id: s.id, ready: eligibleForBuild(s).ok })));

export function Suggestions({ go }: { go: Go }) {
  const t = useTracked();
  const announce = useAnnounce();
  const [tab, setTab] = useState<Tab>('building');
  const today = DATA.today;

  // Each visit records today's grade for everything you track: the confidence history.
  useEffect(() => {
    t.record(today, SUGGESTIONS.map((s) => ({ id: s.id, confidence: s.confidence, reading: s.reading })));
    // Something staged that no longer passes the gate goes back to tracking, so the next build never lists more than it builds.
    for (const s of SUGGESTIONS) if (t.all[s.id]?.state === 'staged' && !eligibleForBuild(s).ok) t.unstage(s.id, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);
  // Opening Suggestions clears the nav badge: everything here is seen, and every ready tracked reading announced.
  const [arrived] = useState(() => badgeSnapshot());
  // While you're here, anything you track or that turns ready counts as seen too (it only writes when something changed).
  useEffect(() => { markSuggestionsSeen(SUGGESTIONS.map((s) => ({ id: s.id, ready: eligibleForBuild(s).ok }))); });

  const visible = SUGGESTIONS.filter((s) => t.all[s.id]?.state !== 'dismissed' && t.all[s.id]?.state !== 'built');
  // Ready is every reading that can go into a build, tracked or not, so a click never moves a card between tabs.
  const ready = visible.filter((s) => eligibleForBuild(s).ok);
  // Readable first, then Caveated; readings with too little data fold into one group so they don't bury the rest.
  const RANK = { good: 0, limited: 1, unusable: 2 } as const;
  const building = visible.filter((s) => !ready.includes(s)).sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || a.label.localeCompare(b.label));
  const collecting = building.filter((s) => s.confidence === 'unusable' && !t.all[s.id]);
  const shown = building.filter((s) => !collecting.includes(s));
  const staged = ready.filter((s) => t.all[s.id]?.state === 'staged');
  const dismissed = SUGGESTIONS.filter((s) => t.all[s.id]?.state === 'dismissed');
  // Foods tracked from Favorite foods that have no reading to suggest yet.
  const watched = MEALS.groups.filter((g) => { const id = foodId(g.name); return t.all[id] && t.all[id].state !== 'dismissed' && t.all[id].state !== 'built' && !SUGGESTIONS.some((x) => x.id === id); });

  return (
    <div className="suggestions stack-16">
      <section className="panel stack-12" aria-labelledby="sugg-h">
        <div className="row between wrap">
          <h2 id="sugg-h" className="title">What your readings point at</h2>
          <Segmented label="Show" items={[{ value: 'building', label: `Building confidence · ${shown.length}` }, { value: 'ready', label: `Ready · ${ready.length}` }]} value={tab} onChange={setTab} />
        </div>
        <p className="small">What LoopStack’s readings point at for your settings and favorite foods, from {DATA.source === 'synthetic' ? 'the sample patient’s' : 'your'} Nightscout history. Track one to watch its confidence build. A reading that’s Readable, within a 20% step and not a safety limit can go into your next build, where Loop shows it as a proposal you confirm in Loop’s own settings.</p>
        {(arrived.fresh > 0 || arrived.reached > 0) && <p className="caption" role="status">{[arrived.fresh ? `${arrived.fresh} new since your last visit` : '', arrived.reached ? `${arrived.reached} tracked ${arrived.reached === 1 ? 'reading' : 'readings'} reached confidence` : ''].filter(Boolean).join(' · ')}</p>}
        {DATA.source === 'synthetic' && <p className="caption">Sample suggestions for the synthetic patient.</p>}
      </section>

      {tab === 'building' ? (
        <>
          {shown.length
            ? <ul className="sugg-list">{shown.map((s) => <Card key={s.id} s={s} tracked={t.all[s.id] ?? null} t={t} today={today} announce={announce} />)}</ul>
            : <section className="panel"><p className="small">{collecting.length ? 'Nothing readable yet. Everything below is still collecting data.' : 'Nothing building right now. Readings that can go into a build are under Ready.'}</p></section>}
          {watched.length > 0 && (
            <section className="panel stack-8" aria-labelledby="watched-h">
              <div className="row between wrap">
                <h3 id="watched-h" className="h3">Foods you’re watching · {watched.length}</h3>
                <button type="button" className="text-btn" onClick={() => go({ view: 'dashboard', tile: 'meals' })}>Open Favorite foods</button>
              </div>
              <p className="caption">Tracked from Favorite foods. Nothing to suggest yet: each shows here as a reading once its meals point to a different absorption time.</p>
              <ul className="collecting-list">
                {watched.map((g) => (
                  <li key={g.name}>
                    <div className="stack-4" style={{ minWidth: 0 }}><span className="small strong">{g.name}</span><span className="caption">{g.n} times in {MEALS.days} days</span></div>
                    <button type="button" className="track-btn glass on" aria-pressed="true" aria-label={`Watching ${g.name}. Press to stop`} onClick={() => { t.forget(foodId(g.name)); announce(`Stopped watching ${g.name}.`); }}>Watching</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {collecting.length > 0 && (
            <details className="panel sugg-collecting">
              <summary><span className="strong">Still collecting data · {collecting.length}</span><span className="caption">Too few clean readings to read yet. Track one to watch it.</span></summary>
              <ul className="collecting-list">
                {collecting.map((s) => (
                  <li key={s.id}>
                    <div className="stack-4" style={{ minWidth: 0 }}><span className="small strong">{s.label}</span><span className="caption">{s.evidence}</span></div>
                    <button type="button" className="track-btn glass" onClick={() => t.track(s.id, today, { date: today, confidence: s.confidence, reading: s.reading })}><IPlus />Track</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <>
          <section className="panel stack-12 ready-bar" aria-labelledby="ready-h">
            <div className="row between wrap">
              <div className="stack-4">
                <h3 id="ready-h" className="h3">Ready to act on</h3>
                <span className="caption">{ready.length} {ready.length === 1 ? 'reading has' : 'readings have'} reached confidence · {staged.length} in your next build</span>
              </div>
              <ReadyActions staged={staged} tracked={t.all} go={go} announce={announce} />
            </div>
          </section>
          {ready.length
            ? <ul className="sugg-list">{ready.map((s) => <Card key={s.id} s={s} tracked={t.all[s.id] ?? null} t={t} today={today} announce={announce} />)}</ul>
            : <section className="panel"><p className="small">Nothing ready yet. Track a reading under Building confidence; it lands here once it’s Readable and within a 20% step.</p></section>}
          <section className="panel"><ShareData tracked={t.all} announce={announce} /></section>
        </>
      )}

      {dismissed.length > 0 && (
        <details className="panel sugg-hidden">
          <summary className="caption">{dismissed.length} hidden</summary>
          <ul className="stack-4">{dismissed.map((s) => <li key={s.id} className="row between"><span className="small">{s.label}</span><button type="button" className="text-btn" onClick={() => t.forget(s.id)}>Show again</button></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Card({ s, tracked, t, today, announce }: { s: Suggestion; tracked: Tracked | null; t: ReturnType<typeof useTracked>; today: string; announce: (m: string) => void }) {
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => { if (!confirmStop) return; const id = window.setTimeout(() => setConfirmStop(false), 4000); return () => window.clearTimeout(id); }, [confirmStop]);
  const [open, setOpen] = useState(false);
  const gate = eligibleForBuild(s);
  const first = { date: today, confidence: s.confidence, reading: s.reading };
  const isStaged = tracked?.state === 'staged' && gate.ok;
  // A Readable reading leaves Building for Ready as soon as it's tracked: say so, since the card moves.
  const track = () => { t.track(s.id, today, first); announce(`Tracking ${s.label}.`); };
  const stage = () => { t.stage(s.id, today, first); announce(`${s.label} added to your next build. It’s under Ready.`); };
  const stop = () => {
    // Stopping clears the confidence history, so a second click confirms when there's history or it's in the next build.
    if (!confirmStop && ((tracked?.history.length ?? 0) > 1 || tracked?.state === 'staged')) { setConfirmStop(true); return; }
    t.forget(s.id); setConfirmStop(false); announce(`Stopped tracking ${s.label}.`);
  };
  const step = stepOf(s);
  return (
    <li className={`sugg-card panel${isStaged ? ' staged' : ''}`}>
      <div className="sugg-head">
        <div className="stack-4" style={{ minWidth: 0 }}>
          <span className="row wrap" style={{ alignItems: 'center' }}>
            <span className="strong">{s.label}</span>
            <span className={`flag ${CONF_FLAG[s.confidence]}`}>{CONFIDENCE_LABEL[s.confidence]}</span>
            <span className="caption">{s.kind === 'food' ? 'Favorite food · absorption' : 'Therapy setting'}</span>
          </span>
          <span className="small ink">{readingLine(s)}</span>
          <span className="caption">{s.evidence}</span>
        </div>
        <div className="sugg-actions">
          {!tracked
            ? <button type="button" className="track-btn glass" onClick={track}><IPlus />Track</button>
            : <button type="button" className="track-btn glass on" aria-pressed="true" aria-label={confirmStop ? `Stop tracking ${s.label}? Its confidence history is cleared` : `Tracking ${s.label}. Press to stop`} onClick={stop}>{confirmStop ? 'Stop tracking?' : 'Tracking'}</button>}
          {/* One primary per screen (the Ready tab's Build), so the per-card action is quiet. A reading that can't go in says why, in words, instead of a disabled button. */}
          {isStaged
            ? <button type="button" className="quiet-btn" aria-pressed="true" onClick={() => t.unstage(s.id, today)}><ICheck />In next build</button>
            : gate.ok && <button type="button" className="quiet-btn" onClick={stage}><IPlus />Add to next build</button>}
          <button type="button" className="expand-btn" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${s.label}`} onClick={() => setOpen((o) => !o)}><IChevron /></button>
        </div>
      </div>
      {!gate.ok && <span className="caption gate-note">Not for the next build yet: {gate.reason.charAt(0).toLowerCase() + gate.reason.slice(1)}</span>}
      {open && (
        <div className="sugg-detail stack-8">
          <dl className="sugg-facts">
            <div><dt className="caption">On file</dt><dd className="strong">{fmtValue(s, s.current)}</dd></div>
            <div><dt className="caption">Reading</dt><dd className="strong">{fmtValue(s, s.reading)}</dd></div>
            <div><dt className="caption">Step</dt><dd className="strong">{step == null ? '—' : `${Math.round(step * 100)}%`}</dd></div>
            <div><dt className="caption">Confidence</dt><dd className="strong">{CONFIDENCE_LABEL[s.confidence]}</dd></div>
          </dl>
          <p className="small">{s.note}</p>
          {tracked && tracked.history.length > 0 && (
            <div className="stack-4">
              <span className="label">Confidence since you started tracking ({tracked.since})</span>
              <ol className="conf-history" aria-label="Confidence by day">
                {tracked.history.map((h) => <li key={h.date} title={`${h.date}: ${CONFIDENCE_LABEL[h.confidence]}, ${fmtValue(s, h.reading)}`}><span className={`dot conf-${h.confidence}`} aria-hidden="true" /><span className="caption">{h.date}</span></li>)}
              </ol>
            </div>
          )}
          {s.kind === 'setting'
            ? <p className="caption">In your next build this arrives in Loop as a proposal on its own screen: on file → reading, with this evidence. Loop saves it only if you confirm it there, under Loop’s guardrails.</p>
            : <p className="caption">In your next build this updates the favorite’s absorption time in Loop; you still pick the favorite and confirm every carb entry on the phone.</p>}
          {tracked?.state !== 'staged' && <div><button type="button" className="text-btn" onClick={() => t.dismiss(s.id, today)}>Hide this suggestion</button></div>}
        </div>
      )}
    </li>
  );
}

/** Copy the tracked records as text, and paste records copied from the phone or another Mac. */
export function ShareData({ tracked, announce }: { tracked: Record<string, Tracked>; announce: (m: string) => void }) {
  const t = useTracked();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const say = (m: string, error = false) => { setNote({ text: m, error }); announce(m); };
  const items = toPortable(tracked);
  const kind = DATA.source === 'synthetic' ? 'sample' : 'real';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(encodeTransfer(items, DATA.source === 'synthetic' ? 'Sample patient' : 'Your Nightscout', DATA.today, kind));
      say(`Copied ${items.length} ${items.length === 1 ? 'item' : 'items'} with their confidence history.`);
    } catch { say('Copying isn’t available here.', true); }
  };
  const doImport = () => {
    const p = parseTransfer(text);
    if (!p.ok) { say(p.error, true); return; }
    if (p.kind && p.kind !== kind) { say(kind === 'sample' ? 'That copy is from your own data. The sample patient only takes sample copies.' : 'That copy is from the sample patient. It would mix demo data into your own.', true); return; }
    const r = t.importItems(p.items);
    setText('');
    setOpen(false);
    say(`Imported: ${r.added} new, ${r.updated} updated.`);
  };
  return (
    <div className="stack-8">
      <h3 className="label">Move between devices</h3>
      <div className="row wrap" role="group" aria-label="Move your tracking between devices">
        <button type="button" className="quiet-btn" disabled={!items.length} onClick={copy}>Copy confidence data</button>
        <button type="button" className="quiet-btn" aria-expanded={open} aria-controls="share-paste" onClick={() => setOpen((v) => !v)}>Paste from another device</button>
      </div>
      {!items.length && <span className="caption">Copy needs something tracked first. Track a suggestion to start its confidence history.</span>}
      {open && (
        <div className="stack-8">
          <label className="label" htmlFor="share-paste">Paste what you copied from LoopStack on your phone or another Mac</label>
          <textarea autoCorrect="off" autoCapitalize="off" spellCheck={false} id="share-paste" className="input" rows={4} autoFocus placeholder="Paste here, then Import" value={text} onChange={(e) => setText(e.target.value)} />
          <div><button type="button" className="quiet-btn" disabled={!text.trim()} onClick={doImport}>Import</button></div>
        </div>
      )}
      {note && <span className={`caption${note.error ? ' error' : ''}`} role={note.error ? 'alert' : 'status'}>{note.text}</span>}
    </div>
  );
}

function ReadyActions({ staged, tracked, go, announce }: { staged: Suggestion[]; tracked: Record<string, Tracked>; go: Go; announce: (m: string) => void }) {
  const bridge = nextBuildBridge();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const brief = useMemo(() => briefFor(staged, tracked, DATA.today), [staged, tracked]);
  const exportIt = async () => {
    setNote(null);
    if (!bridge) {
      // Browser demo: download the brief.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([brief], { type: 'text/markdown' }));
      a.download = `LoopStack next build, ${DATA.today}.md`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      const text = `Downloaded ${a.download}.`;
      setNote({ text, error: false });
      announce(text);
      return;
    }
    const r = await bridge.exportBrief({ markdown: brief });
    if (!r.ok) { setNote({ text: r.error, error: true }); return; }
    if (r.canceled) return;
    const text = `Saved: ${r.path?.split('/').pop() ?? 'the brief'}.`;
    setNote({ text, error: false });
    announce(text);
  };
  return (
    <div className="stack-4" style={{ alignItems: 'flex-end' }}>
      <div className="row wrap" role="group" aria-label="Your next build">
        <button type="button" className="quiet-btn" disabled={!staged.length} onClick={exportIt}>Export</button>
        <button type="button" className="cta glass-green" disabled={!staged.length} onClick={() => { openNextBuild(); go({ view: 'assistant' }); }}>Build</button>
      </div>
      {!staged.length && <span className="caption">Add a ready item to your next build first.</span>}
      {note && <span className={`caption${note.error ? ' error' : ''}`} role={note.error ? 'alert' : 'status'}>{note.text}</span>}
    </div>
  );
}
