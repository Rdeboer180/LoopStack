// Ask & build: the AI connector (step 4 of docs/desktop/loop-branch-plan.md).
// Chat: a back-and-forth about trends and recent changes, seeing the dashboard
// summary and what LoopStack read of the person's Loop repo, both shown first
// (SAFE-7); every reply is checked like an answer (SAFE-1/3/5).
// Ask: a question about the dashboard's numbers, with exactly what's sent shown
// first (SAFE-7) and every answer checked before it's shown (SAFE-1/3/5).
// Build: a feature for the person's Loop, drafted by Claude, reviewed as a diff
// and committed only with the same confirmations as the library (SAFE-3).
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { aiBridge, dataSummary, heldBack, repoSummary } from '../data/ai';
import { githubBridge, setLoopBuild, useLoopBuild, type Commit } from '../data/loopBuild';
import { Segmented, useAnnounce } from '../ui/kit';
import { Diff } from '../ui/Diff';
import { NextBuild } from './NextBuild';
import type { HourSelection } from '../nav';
import { DATA } from '../data/current';
import { rangeLabel } from '../data/derive';
import { hourSummary } from '../data/hourSummary';
import { takeNextBuild } from '../data/intent';
import { AiConnector } from './Other';

type Tab = 'chat' | 'ask' | 'build' | 'next';
const MODES: { value: Tab; label: string }[] = [{ value: 'chat', label: 'Chat' }, { value: 'ask', label: 'Ask about your data' }, { value: 'build', label: 'Build a feature' }, { value: 'next', label: 'Build notes' }];
interface QA { q: string; a: string | null; held: string[]; error: string | null }

export function Assistant({ evidence }: { evidence?: HourSelection }) {
  const ai = aiBridge();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  // Suggestions → Build opens straight on Next build.
  const [tab, setTab] = useState<Tab>(() => (evidence ? 'ask' : takeNextBuild() ? 'next' : 'chat'));
  useEffect(() => {
    let active = true;
    const read = () => { if (ai) void ai.config().then(c => { if (active) setConnected(c.connected); }).catch(() => {
      if (active) { setConnected(false); setConnectionError(true); }
    }); };
    read();
    // The key is set up on this screen: once it's saved, the screen unlocks without a reload.
    const t = ai ? window.setInterval(() => { if (active) read(); }, 2000) : 0;
    return () => { active = false; if (t) window.clearInterval(t); };
  }, [ai]);

  if (!ai) {
    if (tab === 'ask' && evidence) return <div className="stack-16" style={{ width: '100%' }}><Segmented label="Mode" items={MODES} value={tab} onChange={setTab} /><Ask locked evidence={evidence} /></div>;
    if (tab === 'next') return <div className="stack-16" style={{ width: '100%' }}><Segmented label="Mode" items={MODES} value={tab} onChange={setTab} /><NextBuild aiReady={false} /></div>;
    return <div className="stack-16" style={{ width: '100%' }}><Segmented label="Mode" items={MODES} value={tab} onChange={setTab} /><div className="page-cols"><section className="panel stack-12"><h2 className="title">Ask & build</h2><p className="small">The LoopStack desktop app can use your own Anthropic API key to answer questions about your numbers and draft features for your Loop. Open the desktop app and add your key under Settings → AI connector to use it.</p></section></div></div>;
  }
  if (connected === false) {
    // A preview of each mode until a key is added: nothing can be sent.
    return (
      <div className="stack-16" style={{ width: '100%' }}>
        <section className="panel preview-note"><p className="small" role={connectionError ? 'alert' : undefined}><b className="strong">{connectionError ? 'Connection unavailable.' : 'Preview.'}</b> {connectionError ? 'Open Settings → AI connector to check your connection. Your messages have not been sent.' : 'Add your Anthropic API key to start. LoopStack uses your own key; nothing is sent until you ask.'}</p></section>{!connectionError && <AiConnector />}
        <Segmented label="Mode" items={MODES} value={tab} onChange={setTab} />
        {tab === 'chat' ? <Chat locked /> : tab === 'ask' ? <Ask locked evidence={evidence} /> : tab === 'next' ? <NextBuild aiReady={false} /> : <BuildPreview />}
      </div>
    );
  }
  if (connected === null) return <section className="panel" role="status"><p className="small">Checking your AI connection…</p></section>;
  return (
    <div className="stack-16" style={{ width: '100%' }}>
      <Segmented label="Mode" items={MODES} value={tab} onChange={setTab} />
      {tab === 'chat' ? <Chat /> : tab === 'ask' ? <Ask evidence={evidence} /> : tab === 'next' ? <NextBuild aiReady /> : <Build />}
    </div>
  );
}

interface Turn { q: string; a: string | null; held: string[]; error: string | null }

/** The chat. Next build passes its staged items as extra context, a title and a prompt of its own. */
export function Chat({ locked = false, extra, title = 'Chat about your Loop', intro, placeholder }: { locked?: boolean; extra?: Record<string, unknown>; title?: string; intro?: string; placeholder?: string }) {
  const ai = aiBridge()!;
  const gh = githubBridge();
  const build = useLoopBuild();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [repoNote, setRepoNote] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!gh) return;
      const c = await gh.config();
      if (!c.connected) { if (live) setRepoNote('Your Loop repo isn’t connected, so the chat sees your numbers only. Connect it in Settings to talk about recent changes too.'); return; }
      if (!build) { const r = await gh.status(); if (r.ok) setLoopBuild(r.status); }
      const r = await gh.commits();
      if (!live) return;
      if (r.ok) setCommits(r.commits); else setRepoNote(`Couldn’t read your repo’s recent commits: ${r.error}`);
    })().catch(() => { if (live) setRepoNote('Recent repository changes could not be read. The chat can still review the dashboard summary.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gh]);

  const context = useMemo(() => ({ data: dataSummary(), loopRepo: repoSummary(build, commits), ...(extra ?? {}) }), [build, commits, extra]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns.length, busy]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy || locked) return;
    // The context is fixed at the first message so the whole chat is about what was shown.
    const ctx = sent ?? context;
    if (!sent) setSent(ctx);
    // Held-back or failed replies aren't sent back: the history stays person, Claude, person.
    const history = turns.filter((t) => t.a).flatMap((t) => [{ role: 'user' as const, text: t.q }, { role: 'assistant' as const, text: t.a! }]);
    setTurns((l) => [...l, { q, a: null, held: [], error: null }]);
    setText('');
    setBusy(true);
    const r = await ai.chat({ messages: [...history, { role: 'user', text: q }], context: ctx }).catch(() => ({ ok: false as const, error: 'The AI connection was interrupted. Your question is kept below. Check the connection and try again.' }));
    setBusy(false);
    setTurns((l) => {
      const next = l.slice(0, -1);
      if (!r.ok) { setText((cur) => cur || q); return [...next, { q, a: null, held: [], error: r.error }]; }
      const held = heldBack(r.answer);
      return [...next, { q, a: held.length ? null : r.answer, held, error: null }];
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
  };
  const reset = () => { setTurns([]); setSent(null); setText(''); };

  return (
    <div className="page-cols">
      <section className="panel stack-12" aria-labelledby="chat-h">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <h2 id="chat-h" className="title">{title}</h2>
          {turns.length > 0 && <button type="button" className="quiet-btn" onClick={reset} disabled={busy}>New chat</button>}
        </div>
        {turns.length === 0 && <p className="small">{intro ?? 'Talk through trends in your numbers and what’s changed in your Loop lately: a new patch, a Loop update, a settings change. Claude lines changes up with the data by date. It says what happened, never what to change.'}</p>}
        <ol className="ai-log chat-log" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className="stack-8">
              <p className="chat-you small">{t.q}</p>
              {t.error && <p className="caption error" role="alert">{t.error}</p>}
              {t.held.length > 0 && <p className="small ink" role="status">LoopStack held this reply back. It broke a safety rule: {t.held.join('; ')}. Try asking what the data shows instead.</p>}
              {t.a && <div className="ai-answer small">{t.a.split(/\n{2,}/).map((p, k) => <p key={k}>{p}</p>)}</div>}
              {!t.a && !t.error && !t.held.length && busy && i === turns.length - 1 && <p className="caption" role="status">Thinking…</p>}
            </li>
          ))}
        </ol>
        <div ref={end} />
        <form className="stack-8" onSubmit={send}>
          <label className="sr-only" htmlFor="ai-chat">Message</label>
          <textarea id="ai-chat" className="ai-input" rows={3} maxLength={4000} disabled={locked} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={turns.length ? 'Ask a follow-up' : placeholder ?? 'For example: what’s changed in my Loop this month, and how do my afternoons look since then?'} />
          <div className="row wrap"><button type="submit" className="solid-btn" disabled={locked || busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button><span className="caption">{locked ? 'Add your Anthropic API key under Settings → AI connector to chat.' : 'Enter sends, Shift+Enter adds a line. Claude Opus 5.5, with your key.'}</span></div>
        </form>
      </section>
      <aside className="panel stack-8" aria-labelledby="chat-sent-h">
        <h3 id="chat-sent-h" className="h3">What’s sent</h3>
        <p className="small">Your messages, this summary of your dashboard’s numbers and what LoopStack read of your Loop repo: version, patches, customizations, builds and the titles of recent commits. No raw readings, no name, no tokens or addresses. It goes to Anthropic with your key.{sent ? ' This chat uses the summary as it was when you started it.' : ''}</p>
        {repoNote && <p className="caption">{repoNote}</p>}
        <details><summary className="caption">Show what’s sent</summary><pre className="diff">{JSON.stringify(sent ?? context, null, 2)}</pre></details>
      </aside>
    </div>
  );
}

function Ask({ locked = false, evidence }: { locked?: boolean; evidence?: HourSelection }) {
  const ai = aiBridge()!;
  const summary = useMemo(() => evidence ? hourSummary(DATA, evidence) : dataSummary(), [evidence]);
  const [question, setQuestion] = useState(() => evidence
    ? 'What do the ' + DATA.WEEKDAY_GRID.days[evidence.weekday].label + ' readings from ' + rangeLabel(evidence.hour, evidence.hour + 1) + ' show, and what limits the comparison?'
    : '');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<QA[]>([]);
  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || locked || busy) return;
    setQuestion('');
    setBusy(true);
    const r = await ai.ask({ question: q, summary }).catch(() => ({ ok: false as const, error: 'The AI connection was interrupted. Your question was kept. Check the connection and try again.' }));
    setBusy(false);
    if (!r.ok) { setQuestion((cur) => cur || q); setLog((l) => [{ q, a: null, held: [], error: r.error }, ...l]); return; }
    const held = heldBack(r.answer);
    setLog((l) => [{ q, a: held.length ? null : r.answer, held, error: null }, ...l]);
  };
  return (
    <div className="page-cols">
      <section className="panel stack-12" aria-labelledby="ask-h">
        <h2 id="ask-h" className="title">Ask about your data</h2>
        <form className="stack-8" onSubmit={ask}>
          <label className="sr-only" htmlFor="ai-q">Your question</label>
          <textarea id="ai-q" className="ai-input" rows={3} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: which hours does Loop most often deliver less than scheduled, and what is my glucose doing then?" />
          <div className="row wrap"><button type="submit" className="solid-btn" disabled={locked || busy || !question.trim()}>{busy ? 'Asking…' : 'Ask'}</button><span className="caption">{locked ? (ai ? 'Add your Anthropic API key under Settings → AI connector to ask.' : 'Open LoopStack desktop and connect your AI key to send this question.') : 'Claude Opus 5.5, with your key. Answers say what the data shows, never what to change.'}</span></div>
        </form>
        <ol className="ai-log">
          {log.map((x, i) => (
            <li key={log.length - i} className="stack-4">
              <span className="strong">{x.q}</span>
              {x.error && <p className="caption error" role="alert">{x.error}</p>}
              {x.held.length > 0 && <p className="small ink" role="status">LoopStack held this answer back. It broke a safety rule: {x.held.join('; ')}. Try asking what the data shows instead.</p>}
              {x.a && <div className="ai-answer small">{x.a.split(/\n{2,}/).map((p, k) => <p key={k}>{p}</p>)}</div>}
            </li>
          ))}
        </ol>
      </section>
      <aside className="panel stack-8" aria-labelledby="sent-h">
        <h3 id="sent-h" className="h3">What’s sent</h3>
        <p className="small">{evidence ? 'When you press Ask, Anthropic receives your question and the hour summary below.' : 'Your question and this summary of the numbers on your dashboard. No raw readings, no name, no Nightscout address or token. It goes to Anthropic with your key.'}</p>
        <details open={evidence ? true : undefined}><summary className="caption">Show the summary</summary><pre className="diff">{JSON.stringify(summary, null, 2)}</pre></details>
      </aside>
    </div>
  );
}

function BuildPreview() {
  return (
    <div className="page-cols">
      <section className="panel stack-12" aria-labelledby="build-prev-h">
        <h2 id="build-prev-h" className="title">Build a feature</h2>
        <p className="small">Describe a change to your Loop. Claude picks the source files it needs and drafts the change. You read every line before anything is committed to your Loop branch, and nothing reaches your phone until you build and install it.</p>
        <label className="sr-only" htmlFor="ai-d-prev">The feature</label>
        <textarea id="ai-d-prev" className="ai-input" rows={4} disabled placeholder="For example: show the pod’s age in hours next to the pump icon on the status screen." />
        <div className="row wrap"><button type="button" className="solid-btn" disabled>Draft it</button></div>
        <p className="caption">Needs your Anthropic API key and your Loop connected, both under Settings. Never drafted: changes to therapy settings or guardrails, or removing confirmations.</p>
      </section>
      <aside className="panel stack-8"><p className="small">The drafted change shows here for review.</p></aside>
    </div>
  );
}

type Step = 'describe' | 'review' | 'dosing' | 'done';

function Build() {
  const ai = aiBridge()!;
  const gh = githubBridge();
  const build = useLoopBuild();
  const announce = useAnnounce();
  const [ghConnected, setGh] = useState<boolean | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Extract<Awaited<ReturnType<typeof ai.draft>>, { ok: true }> | null>(null);
  const [step, setStep] = useState<Step>('describe');
  const [readIt, setReadIt] = useState(false);
  const [doseOk, setDoseOk] = useState(false);
  const [commit, setCommit] = useState<{ sha: string; url: string } | null>(null);
  const [built, setBuilt] = useState(false);
  useEffect(() => {
    void gh?.config().then((c) => {
      setGh(c.connected);
      if (c.connected && !build) void gh.status().then((s) => s.ok && setLoopBuild(s.status));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gh]);

  if (ghConnected === false) return <section className="panel stack-12"><h2 className="title">Build a feature</h2><p className="small">Connect your Loop under Settings → Your Loop first.</p></section>;

  const draftIt = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await ai.draft({ description });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDraft(r);
    setReadIt(false);
    setDoseOk(false);
    setStep('review');
  };
  const commitIt = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const r = await ai.commit({ id: draft.id, reviewed: readIt, confirmDosing: draft.dosing && doseOk });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCommit(r.commit);
    setStep('done');
    announce(`${draft.title} committed to your Loop branch.`);
  };
  const buildNow = async () => {
    if (!gh) return;
    const r = await gh.build();
    if (!r.ok) { setError(r.error); return; }
    setBuilt(true);
  };

  return (
    <div className="page-cols">
      <section className="panel stack-12" aria-labelledby="build-h">
        <h2 id="build-h" className="title">Build a feature</h2>
        <p className="small">Describe a change to {build ? `Loop ${build.loopVersion ?? ''} on ${build.owner}/${build.repo} · ${build.branch}` : 'your Loop'}. Claude picks the source files it needs and drafts the change. You read every line before anything is committed, and nothing reaches your phone until you build and install it.</p>
        <form className="stack-8" onSubmit={draftIt}>
          <label className="sr-only" htmlFor="ai-d">The feature</label>
          <textarea id="ai-d" className="ai-input" rows={4} maxLength={3000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="For example: show the pod’s age in hours next to the pump icon on the status screen." disabled={busy || step === 'review' || step === 'dosing'} />
          {(step === 'describe' || step === 'done') && <div className="row wrap"><button type="submit" className="solid-btn" disabled={busy || description.trim().length < 10}>{busy ? 'Drafting… this takes a minute or two' : 'Draft it'}</button></div>}
        </form>
        <p className="caption">Never drafted: changes to therapy settings or guardrails, or removing confirmations. Your description and the Loop source files it needs go to Anthropic with your key.</p>
        {error && <p className="caption error" role="alert">{error}</p>}
      </section>
      <aside className="panel stack-12 lib-detail" aria-label="The draft">
        {!draft ? <p className="small">The drafted change shows here for review.</p> : (
          <>
            <div className="stack-4">
              <h3 className="h3">{draft.title}</h3>
              <span className={`flag${draft.dosing ? ' dose' : ''}`}>{draft.dosing ? 'Changes dosing' : 'No dosing change found'}</span>
              <p className="small">{draft.summary}</p>
            </div>
            {step === 'done' && commit ? (
              <div className="stack-8" role="status">
                <p className="small ink">Committed: <a href={commit.url} target="_blank" rel="noreferrer">{commit.sha?.slice(0, 7)}</a>. Your next build includes it. Nothing changes on your phone until you install that build. Remove it from the Feature library’s history or your branch’s patches folder.</p>
                {built ? <p className="small">Build started. It takes 20 to 30 minutes.</p> : <div className="row wrap"><button type="button" className="solid-btn" onClick={buildNow}>Build now</button><button type="button" className="quiet-btn" onClick={() => { setDraft(null); setStep('describe'); setDescription(''); setCommit(null); setBuilt(false); }}>Draft another</button></div>}
              </div>
            ) : (
              <>
                <ul className="lib-files">{draft.files.map((f) => <li key={f.path}><code>{f.path}</code><span className="caption">{f.added} added · {f.removed} removed</span></li>)}</ul>
                <Diff text={draft.patch} />
                <p className="caption">Drafted by Claude and checked to fit your Loop’s code. LoopStack hasn’t compiled it: if it doesn’t build, the build fails and your current Loop keeps running.</p>
                {step === 'review' ? (
                  <div className="stack-8">
                    <label className="check-row"><input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} /> I’ve read this change</label>
                    <div className="row wrap">
                      <button type="button" className="solid-btn" disabled={!readIt || busy} onClick={() => (draft.dosing ? setStep('dosing') : commitIt())}>{busy ? 'Committing…' : 'Add to my Loop branch'}</button>
                      <button type="button" className="quiet-btn" onClick={() => { setDraft(null); setStep('describe'); }}>Discard</button>
                    </div>
                  </div>
                ) : (
                  <div className="stack-8 dose-confirm" role="group" aria-labelledby="ai-dose-h">
                    <h3 id="ai-dose-h" className="label">This changes how Loop doses</h3>
                    <p className="small ink">Code an AI wrote, changing how Loop doses, predicts, or what it’s told. No one in the Loop community has reviewed it. Watch the first days on the new build closely, and tell your care team.</p>
                    <label className="check-row"><input type="checkbox" checked={doseOk} onChange={(e) => setDoseOk(e.target.checked)} /> I understand this changes how Loop doses, and I’m choosing it</label>
                    <div className="row wrap">
                      <button type="button" className="solid-btn" disabled={!doseOk || busy} onClick={commitIt}>{busy ? 'Committing…' : 'Commit it to my branch'}</button>
                      <button type="button" className="quiet-btn" onClick={() => { setStep('review'); setDoseOk(false); }}>Back</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
