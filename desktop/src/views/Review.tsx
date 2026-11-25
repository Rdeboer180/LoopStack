// "Care-team review": a clinician's read of the packet the person shared, for a 1–2
// minute visit read. Fixed layout, same order for every patient (PROD-1).
// Page one is glucose only, in AGP order (VIS-10). Clinician terms (DATA-2,
// DM-9). Nothing here changes the pump or the person's settings (SAFE-3).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { REPORT_STYLES, useReportStyle, type ReportStyle, type StyleId } from '../data/reportStyles';
import { ReviewBlock } from './reviewBlocks';
import { DATA, PATIENT, PATIENTS, PERIOD, QUESTION } from '../data/current';
import type { Go, Route } from '../nav';
import { useStore } from '../state';
import { Thread } from '../tiles/faces';
import { IMail, IPdf, TileSelect, useAnnounce } from '../ui/kit';

export function Review({ route, go }: { route: Route; go: Go }) {
  const { packet } = useStore();
  const patient = PATIENTS.find((p) => p.id === route.patient) ?? PATIENTS[0];
  // One patient (your own packet): no list column; its facts and flags sit in the header instead.
  if (PATIENTS.length === 1) {
    return (
      <div className="review solo">
        {patient.packet ? <SamReview route={route} go={go} flags={patient.flags} /> : <NoPacket name={patient.name} system={patient.system} last={patient.lastPacket} visit={patient.visit} />}
      </div>
    );
  }
  return (
    <div className="review">
      <nav className="patients" aria-label="Patients">
        <h2 className="label">{DATA.source === 'synthetic' ? 'This week’s visits' : 'Your packet'}</h2>
        <ul>
          {PATIENTS.map((p) => {
            const shared = p.id === PATIENTS[0].id ? packet.shared : null;
            return (
              <li key={p.id}>
                <button type="button" className="patient-row" aria-current={p.id === patient.id ? 'page' : undefined} onClick={() => go({ patient: p.id, section: 'glucose' })}>
                  <span className="avatar" aria-hidden="true">{p.initials}</span>
                  <span className="stack">
                    <span className="strong">{p.name}</span>
                    <span className="caption">{shared ? `Packet shared ${shared}` : p.lastPacket ? `Last packet ${p.lastPacket}` : 'No packet yet'}</span>
                    {p.flags.length > 0 && <span className="flags">{p.flags.map((f) => <span key={f} className="flag">{f}</span>)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="caption">{DATA.source === 'synthetic' ? 'Synthetic patients. ' : ''}Visit {patient.visit}.</p>
      </nav>
      {patient.packet ? <SamReview route={route} go={go} /> : <NoPacket name={patient.name} system={patient.system} last={patient.lastPacket} visit={patient.visit} />}
    </div>
  );
}

function NoPacket({ name, system, last, visit }: { name: string; system: string; last: string | null; visit: string }) {
  return (
    <section className="review-main" aria-label={name}>
      <header className="patient-head">
        <h2 className="title">{name}</h2>
        <span className="small">{system} · visit {visit}</span>
      </header>
      <div className="panel empty">
        <p className="lead-sm">No packet for this visit yet.</p>
        <p className="small">{name.split(' ')[0]} hasn’t shared a review packet for {visit}.{last ? ` The last one (${last}) is no longer readable.` : ''} LoopStack shows the care team only what a patient chooses to share, as a snapshot, never a live feed.</p>
        <p className="caption">Nothing to read here rather than a guess.</p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ save as PDF, or email it

type Export = 'save' | 'email';
interface ReviewBridge { pdf: (input: { action: Export }) => Promise<{ ok: true; canceled?: boolean; path?: string } | { ok: false; error: string }> }
const reviewBridge = (): ReviewBridge | null => (window.loopstack as { review?: ReviewBridge } | undefined)?.review ?? null;
// A frame, or 500 ms if frames are paused (a hidden window doesn't paint).
const nextFrame = () => Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), new Promise<void>((r) => setTimeout(r, 500))]);

/** Save as PDF and Email: the whole packet, every section in review order, not just the open tab. */
function ExportButtons({ route, style }: { route: Route; style: ReportStyle }) {
  const bridge = reviewBridge();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<Export | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!busy) return;
    let live = true;
    void (async () => {
      // Two frames and a beat so the charts in the print layout measure themselves first.
      await nextFrame(); await nextFrame(); await new Promise((r) => setTimeout(r, 150));
      if (!bridge) { try { window.print(); } finally { if (live) setBusy(null); } return; }
      let r: Awaited<ReturnType<ReviewBridge['pdf']>>;
      try {
        r = await bridge.pdf({ action: busy });
      } catch (err) {
        r = { ok: false, error: `Couldn’t make the PDF: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        // Always release the buttons, even if the main process threw.
        if (live) setBusy(null);
      }
      if (!live) return;
      if (!r.ok) { setNote({ text: r.error, error: true }); return; }
      if (r.canceled) return;
      const text = busy === 'email' ? 'A new Mail message is open with the review attached. Nothing is sent until you send it.' : `Saved: ${r.path?.split('/').pop() ?? 'the PDF'}.`;
      setNote({ text, error: false });
      announce(text);
    })();
    return () => { live = false; };
  }, [busy, bridge, announce]);

  // The buttons sit in the top bar beside the other page actions; the status line stays with the packet.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('topbar-actions')); }, []);
  const buttons = (
    <div className="row export-row" role="group" aria-label="Export the review">
      <button type="button" className="cta glass-green" disabled={busy !== null} onClick={() => { setNote(null); setBusy('save'); }}><IPdf />{busy === 'save' ? 'Making the PDF…' : bridge ? 'Save as PDF' : 'Print or save PDF'}</button>
      {/* Email needs the desktop app (it opens Mail with the PDF attached); the browser demo only prints. */}
      {bridge && <button type="button" className="cta glass-green" disabled={busy !== null} onClick={() => { setNote(null); setBusy('email'); }}><IMail />{busy === 'email' ? 'Making the PDF…' : 'Email'}</button>}
    </div>
  );
  return (
    <>
      {slot ? createPortal(buttons, slot) : buttons}
      {note && <p className={`caption export-note${note.error ? ' error' : ''}`} role={note.error ? 'alert' : 'status'}>{note.text}</p>}
      {busy && createPortal(<PrintPacket route={route} style={style} />, document.body)}
    </>
  );
}

/** Every section of the packet, laid out for paper. Off screen on screen; the only thing printed. */
function PrintPacket({ route, style }: { route: Route; style: ReportStyle }) {
  const { packet } = useStore();
  const go: Go = () => {};
  return (
    <div className="print-root" aria-hidden="true">
      <div className="review-main print-packet">
        <header className="patient-head print-head">
          <h2 className="title">{PATIENT.name}{PATIENT.age != null && <span className="small"> · {PATIENT.age}</span>}</h2>
          <span className="small">{PATIENT.setup} · {PERIOD.label} · visit {PATIENT.nextVisit} · packet shared {packet.shared}</span>
          <span className="caption">LoopStack care-team review. What the data shows; it doesn’t change the pump or {PATIENT.first}’s settings.{DATA.source === 'synthetic' ? ' Synthetic patient.' : ''}</span>
          {style.id !== 'loopstack' && <span className="caption">{style.label}. {style.note}</span>}
        </header>
        {style.sections.map((sec) => (
          <section key={sec.id} className="print-page review-panel" aria-label={sec.label}>
            <h2 className="label print-section">{sec.label}</h2>
            <div className="stack-16">{sec.blocks.map((b) => <ReviewBlock key={b} id={b} route={{ ...route, section: 'loop' }} go={go} terms={style.terms} numbered={style.numbered} />)}</div>
          </section>
        ))}
        <section className="print-page-last panel stack-8">
          {QUESTION ? (
            <>
              <h3 className="label">{PATIENT.first} asks · {QUESTION.date}</h3>
              <p className="lead-sm">{QUESTION.text}</p>
              <ul className="print-options">{QUESTION.options.map((o) => <li key={o.id} className="small"><span className="strong">{o.id} · {o.label}</span> · {o.how}</li>)}</ul>
            </>
          ) : <h3 className="label">No open question in this packet</h3>}
          <h3 className="label">Thread with {PATIENT.first}</h3>
          <Thread side="clinician" limit={4} />
        </section>
      </div>
    </div>
  );
}

function SamReview({ route, go, flags = [] }: { route: Route; go: Go; flags?: readonly string[] }) {
  const { packet } = useStore();
  const [style, setStyle] = useReportStyle();
  const sections = style.sections;
  // LoopStack's own sections live in the URL (so a section can be linked); another style keeps its tab here.
  const [localSec, setLocalSec] = useState<string | null>(null);
  const active = style.id === 'loopstack' ? route.section : sections.some((x) => x.id === localSec) ? localSec! : sections[0].id;
  const current = sections.find((x) => x.id === active) ?? sections[0];
  const pick = (id: string) => (style.id === 'loopstack' ? go({ section: id as Route['section'] }, { replace: true }) : setLocalSec(id));
  return (
    <section className="review-main" aria-label={`${PATIENT.name}, review packet`}>
      <header className="patient-head">
        <div className="stack-4">
          <div className="row wrap name-row">
            <h2 className="title">{PATIENT.name}{PATIENT.age != null && <span className="small"> · {PATIENT.age}</span>}</h2>
            {flags.map((f) => <span key={f} className="flag">{f}</span>)}
          </div>
          {/* One line of facts, plain text so they don't read as controls: the setup, then the packet. */}
          <ul className="packet-meta" aria-label="This packet">
            <li>{PATIENT.setup}{PATIENT.buildExpiresDays != null ? ` · build expires in ${PATIENT.buildExpiresDays} days` : ''}</li>
            <li><span className="caption">Period</span> {PERIOD.label}</li>
            <li><span className="caption">Visit</span> {PATIENT.nextVisit}</li>
            <li><span className="caption">Shared</span> {packet.shared}</li>
            <li><span className="caption">Involvement</span> {PATIENT.engagement.toLowerCase()}</li>
          </ul>
          <ExportButtons route={route} style={style} />
        </div>
        <div className="tabs-row">
          <div role="tablist" aria-label="Review sections" className="tabs">
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                role="tab"
                id={`tab-${sec.id}`}
                aria-selected={active === sec.id}
                aria-controls={`panel-${sec.id}`}
                tabIndex={active === sec.id ? 0 : -1}
                onClick={() => pick(sec.id)}
                onKeyDown={(e) => {
                  const i = sections.findIndex((x) => x.id === active);
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = sections[(i + d + sections.length) % sections.length].id;
                  pick(next);
                  requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
                }}
              >
                {sec.label}
              </button>
            ))}
          </div>
          {/* The system's pill select (TileSelect), not a native <select>: macOS drew that one with its own heavy ring. */}
          <div className="style-pick">
            <span className="caption" aria-hidden="true">Report style</span>
            <TileSelect<StyleId> label="Report style" value={style.id} options={REPORT_STYLES.map((r) => ({ value: r.id, label: r.label }))} onChange={setStyle} />
          </div>
        </div>
        {style.id !== 'loopstack' && <p className="caption style-note">{style.note}</p>}
      </header>
      <div className="review-body">
        <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="review-panel">
          <div className="stack-16">
            {current.blocks.map((b) => <ReviewBlock key={`${style.id}-${b}`} id={b} route={route} go={go} terms={style.terms} numbered={style.numbered} onEvidence={style.id === 'loopstack' ? (sec) => pick(sec) : undefined} />)}
          </div>
        </div>
        <QuestionRail />
      </div>
    </section>
  );
}

export { ChangeTimeline } from './reviewBlocks';

// ------------------------------------------------------------ Sam's question

function QuestionRail() {
  const { send, decision } = useStore();
  const announce = useAnnounce();
  const [option, setOption] = useState<string | null>(null);
  const [modifying, setModifying] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // What was just sent: the buttons give way to it, so one click can't send twice.
  const [sent, setSent] = useState<string | null>(null);
  const opt = QUESTION?.options.find((o) => o.id === option);

  const record = (kind: 'agree' | 'modify' | 'discuss', text: string) => {
    send({ from: 'clinician', date: DATA.today, text, decision: kind });
    announce(`Reply recorded in ${PATIENT.first}’s thread: ${text}`);
    setSent(text);
    setModifying(false);
    setNote('');
    setError(null);
    requestAnimationFrame(() => document.getElementById('thread-h')?.scrollIntoView({ block: 'nearest' }));
  };
  const agree = () => {
    if (!opt) { setError('Pick an option first.'); return; }
    record('agree', `Agreed on ${opt.id}, ${opt.label}. You apply it in Loop; we’ll look at the two weeks after at the follow-up.`);
  };
  const modify = () => {
    if (!modifying) { setModifying(true); setError(null); return; }
    if (!note.trim()) { setError('Add a note on what to change.'); return; }
    record('modify', `Modify${opt ? ` ${opt.id}, ${opt.label}` : ''}: ${note.trim()}`);
  };

  if (!QUESTION) {
    return (
      <aside className="rail" aria-label={`${PATIENT.first}’s question`}>
        <section className="panel stack-12" aria-labelledby="ask-h">
          <h3 id="ask-h" className="label">{PATIENT.first}’s question</h3>
          <p className="small">No open question in this packet. When {PATIENT.first} asks one, it shows here with Agree, Modify and Discuss.</p>
          <p className="caption never">LoopStack never changes the pump or {PATIENT.first}’s settings. {PATIENT.first} makes any change in Loop.</p>
        </section>
        <section className="panel stack-8" aria-labelledby="thread-h">
          <h3 id="thread-h" className="label">Thread with {PATIENT.first}</h3>
          <Thread side="clinician" limit={4} />
        </section>
      </aside>
    );
  }
  return (
    <aside className="rail" aria-label={`${PATIENT.first}’s question`}>
      <section className="panel stack-12" aria-labelledby="ask-h">
        <div className="row between baseline">
          <h3 id="ask-h" className="label">{PATIENT.first} asks · {QUESTION.date}</h3>
          <span className="caption">{decision ? 'replied' : 'waiting on you'}</span>
        </div>
        <p className="lead-sm">{QUESTION.text}</p>
        <span className="caption">Attached: {QUESTION.attached}</span>
        <fieldset className="options">
          <legend className="sr-only">Options {PATIENT.first} named</legend>
          {QUESTION.options.map((o) => (
            <label key={o.id} className={`option${option === o.id ? ' on' : ''}`}>
              <input type="radio" name="q-option" value={o.id} checked={option === o.id} onChange={() => { setOption(o.id); setError(null); }} />
              <span className="stack">
                <span className="strong">{o.id} · {o.label}</span>
                <span className="caption">{o.how}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {modifying && (
          <div className="stack-4">
            <label className="caption strong" htmlFor="modify-note">What would you change?</label>
            <textarea id="modify-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: start with the preset for two Fridays, then compare" />
          </div>
        )}
        {sent ? (
          <div className="decide-sent" role="status">
            <p className="small"><b className="strong">Sent · {DATA.today}.</b> {sent}</p>
            <button type="button" className="text-btn" onClick={() => setSent(null)}>Send another reply</button>
          </div>
        ) : (
          <>
            <div className="decide" role="group" aria-label={`Reply to ${PATIENT.first}`}>
              <button type="button" className="cta glass-green" onClick={agree} disabled={!opt} aria-describedby={!opt ? 'decide-hint' : undefined}>Agree{opt ? ` on ${opt.id}` : ''}</button>
              <button type="button" className="decide-btn" onClick={modify}>{modifying ? 'Send modify' : 'Modify'}</button>
              <button type="button" className="decide-btn" onClick={() => record('discuss', `Let’s discuss this at the visit on ${PATIENT.nextVisit}.`)}>Discuss</button>
            </div>
            {!opt && <p id="decide-hint" className="caption">Pick one of {PATIENT.first}’s options to agree to it.</p>}
          </>
        )}
        {error && <p className="caption error" role="alert">{error}</p>}
        <p className="caption never">LoopStack never changes the pump or {PATIENT.first}’s settings. {PATIENT.first} makes any change in Loop.</p>
      </section>
      <section className="panel stack-8" aria-labelledby="thread-h">
        <h3 id="thread-h" className="label">Thread with {PATIENT.first}</h3>
        <Thread side="clinician" limit={4} />
      </section>
    </aside>
  );
}
