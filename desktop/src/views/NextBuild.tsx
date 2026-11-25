// Next build (PRODUCT.md SAFE-5a): the suggestions you added from Suggestions,
// ready to go into your Loop branch. Choose each setting as a branch feature
// (its own patch, switchable in the Feature library) or in code (the shared
// proposals screen); talk them through in the chat; then preview the exact
// patches, read them, confirm the dosing change, and commit. LoopStack writes
// the patches itself from the readings; the chat never picks a value.
import { useEffect, useMemo, useState } from 'react';
import { DATA, SUGGESTIONS } from '../data/current';
import { githubBridge, setLoopBuild, useLoopBuild } from '../data/loopBuild';
import { nextBuildBridge, nextItems } from '../data/nextBuild';
import { eligibleForBuild, fmtValue } from '../data/suggestions';
import { useTracked, type BuildAs } from '../data/tracked';
import { briefFor } from '../data/nextBuild';
import { ShareData } from './Suggestions';
import { buildNotesBridge } from '../data/buildNotes';
import { Segmented, useAnnounce } from '../ui/kit';
import { Chat } from './Assistant';
import { Diff } from '../ui/Diff';

type Preview = { path: string; title: string; patch: string; files: { path: string; isNew: boolean; added: number; removed: number }[] }[];

export function NextBuild({ aiReady }: { aiReady: boolean }) {
  const t = useTracked();
  const bridge = nextBuildBridge();
  const gh = githubBridge();
  const build = useLoopBuild();
  const announce = useAnnounce();
  const staged = SUGGESTIONS.filter((s) => t.all[s.id]?.state === 'staged' && eligibleForBuild(s).ok);
  const items = useMemo(() => nextItems(staged, t.all), [staged, t.all]);
  const extra = useMemo(() => ({ nextBuild: { note: 'Readings the person added to their next build from LoopStack Suggestions (SAFE-5a). LoopStack writes the patches from these values itself; help them decide branch feature vs in code and what to watch after, never different values.', items } }), [items]);

  const builtItems = Object.values(t.all).filter((x) => x.state === 'built');
  const [briefNote, setBriefNote] = useState<string | null>(null);
  const copyBrief = async () => {
    try { await navigator.clipboard.writeText(briefFor(staged, t.all, DATA.today)); setBriefNote('Copied. Paste it into your LLM.'); announce('Copied the build notes.'); }
    catch { setBriefNote('Copying isn’t available here.'); }
  };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipped, setSkipped] = useState<{ id: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readIt, setReadIt] = useState(false);
  const [doseOk, setDoseOk] = useState(false);
  const [commit, setCommit] = useState<{ sha: string; url: string } | null>(null);
  const [built, setBuilt] = useState(false);
  const reset = () => { setPreview(null); setReadIt(false); setDoseOk(false); setError(null); };
  // A preview describes exactly these items: if they change (here, in Suggestions or another window), it's cleared.
  const itemsKey = JSON.stringify(items.map((i) => [i.id, i.reading, i.buildAs]));
  useEffect(() => { reset(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const setAs = (id: string, as: BuildAs) => { t.buildAs(id, as, DATA.today); reset(); };
  const doPreview = async () => {
    if (!bridge) return;
    setBusy(true); setError(null); setCommit(null);
    const r = await bridge.preview({ items });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.patches); setSkipped(r.skipped);
  };
  const doCommit = async () => {
    if (!bridge) return;
    setBusy(true); setError(null);
    const r = await bridge.commit({ items, reviewed: readIt, confirmDosing: doseOk });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCommit(r.commit);
    t.markBuilt(items.map((i) => i.id), r.commit.sha, DATA.today);
    announce('Committed to your Loop branch.');
  };
  const buildNow = async () => {
    if (!gh) return;
    const r = await gh.build();
    if (!r.ok) { setError(r.error); return; }
    setBuilt(true);
    window.setTimeout(() => { void gh.status().then((s) => s.ok && setLoopBuild(s.status)); }, 5000);
  };

  return (
    <div className="stack-16" style={{ width: '100%' }}>
      <div className="page-cols">
        <section className="panel stack-12" aria-labelledby="next-h">
          <h2 id="next-h" className="title">Build notes</h2>
          <p className="small">Readings you added from Suggestions. Each one is Readable, within a 20% step of what’s on file, and never a safety limit. Settings arrive in Loop as proposals on their own screen: nothing changes until you tap Apply in Loop, under Loop’s guardrails.</p>
          {commit ? (
            <div className="stack-8" role="status">
              <p className="small ink">Committed to {build?.branch ?? 'your branch'}: <a href={commit.url} target="_blank" rel="noreferrer">{commit.sha.slice(0, 7)}</a>. Your next build includes it. Nothing changes on your phone until you install that build and apply each proposal in Loop.</p>
              {built ? <p className="small">Build started. It takes 20 to 30 minutes.</p> : gh && <div><button type="button" className="cta glass-green" onClick={buildNow}>Build now</button></div>}
            </div>
          ) : !items.length ? (
            <p className="small">Nothing in your next build yet. Under Suggestions → Ready, add a reading to your next build.</p>
          ) : (
            <ul className="next-build-list">
              {items.map((i) => {
                const s = staged.find((x) => x.id === i.id)!;
                return (
                  <li key={i.id}>
                    <div className="stack-4" style={{ minWidth: 0 }}>
                      <span className="strong">{i.label}</span>
                      <span className="caption">{fmtValue(s, i.current)} → {fmtValue(s, i.reading)} · {i.evidence}</span>
                    </div>
                    {i.kind === 'setting'
                      ? <Segmented size="sm" label={`Build ${i.label} as`} items={[{ value: 'branch', label: 'Branch feature' }, { value: 'code', label: 'In code' }]} value={i.buildAs} onChange={(v) => setAs(i.id, v)} />
                      : <span className="caption">Favorites patch</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 0 && !commit && (
            <div className="row wrap">
              <button type="button" className="quiet-btn" onClick={copyBrief}>Copy for your LLM</button>
              {briefNote && <span className="caption" role="status">{briefNote}</span>}
            </div>
          )}
          {builtItems.length > 0 && (
            <div className="stack-8">
              <h3 className="h3">Built</h3>
              <ul className="next-build-list">
                {builtItems.map((b) => (
                  <li key={b.id}>
                    <div className="stack-4" style={{ minWidth: 0 }}>
                      <span className="strong">{SUGGESTIONS.find((s) => s.id === b.id)?.label ?? b.id}</span>
                      <span className="caption">{b.builtAt ? `Built ${b.builtAt}` : 'Built'}{b.commit ? ` · ${b.commit.slice(0, 7)}` : ''} · {b.history.length} {b.history.length === 1 ? 'day' : 'days'} of confidence kept</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ConnectLlm announce={announce} />
          <ShareData tracked={t.all} announce={announce} />
          {!commit && items.length > 0 && <p className="caption">Branch feature: its own patch, switched on and off in the Feature library. In code: part of the LoopStack proposals screen patch.</p>}
        </section>
        <aside className="panel stack-12 lib-detail" aria-label="The patches">
          {!bridge ? <p className="small">The LoopStack desktop app writes these patches to your Loop branch. In this preview, nothing is written.</p>
            : !gh ? <p className="small">Connect your Loop under Settings → Your Loop to preview and commit.</p>
            : commit ? <p className="small">Done. Remove any of these later from the Feature library or your branch’s patches folder.</p>
            : !preview ? (
              <div className="stack-8">
                <p className="small">Preview the exact patches LoopStack writes, checked to apply on top of every patch already in your branch.</p>
                <div><button type="button" className="cta glass-green" disabled={!items.length || busy} onClick={doPreview}>{busy ? 'Checking against your Loop…' : 'Preview patches'}</button></div>
              </div>
            ) : (
              <div className="stack-12">
                {skipped.length > 0 && <p className="caption">Left out: {skipped.map((x) => `${x.id} (${x.reason})`).join(', ')}</p>}
                {preview.map((p) => (
                  <div key={p.path} className="stack-8">
                    <span className="strong">{p.title}</span>
                    <ul className="lib-files">{p.files.map((f) => <li key={f.path}><code>{f.path}</code><span className="caption">{f.added} added · {f.removed} removed</span></li>)}<li><code>{p.path}</code><span className="caption">new patch file</span></li></ul>
                    <Diff text={p.patch} />
                  </div>
                ))}
                <p className="caption">Checked to fit your Loop’s code with your patches. LoopStack hasn’t compiled it: if it doesn’t build, the build fails and your current Loop keeps running.</p>
                <label className="check-row"><input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} /> I’ve read these changes</label>
                <div className="stack-8 dose-confirm" role="group" aria-labelledby="next-dose-h">
                  <h3 id="next-dose-h" className="label">This changes how Loop doses</h3>
                  <p className="small ink">Each proposal, once you apply it in Loop, changes a therapy setting. Watch the days after, and tell your care team.</p>
                  <label className="check-row"><input type="checkbox" checked={doseOk} onChange={(e) => setDoseOk(e.target.checked)} /> I understand these change how Loop doses, and I’m choosing them</label>
                </div>
                <div className="row wrap">
                  <button type="button" className="cta glass-green" disabled={!readIt || !doseOk || busy} onClick={doCommit}>{busy ? 'Committing…' : 'Commit to my Loop branch'}</button>
                  <button type="button" className="quiet-btn" onClick={reset}>Back</button>
                </div>
              </div>
            )}
          {error && <p className="caption error" role="alert">{error}</p>}
        </aside>
      </div>
      {items.length > 0 && !commit && (
        <Chat locked={!aiReady} extra={extra} title="Talk it through" intro="Ask about these readings before you build: what each one rests on, branch feature or in code, what to watch in the days after. Claude sees the items above with your dashboard summary. It says what the data shows, never different values." placeholder="For example: which of these rests on the most days, and what should I watch after the basal change?" />
      )}
    </div>
  );
}

/** How to register the read-only build-notes server with Claude, with this Mac's real paths. */
function ConnectLlm({ announce }: { announce: (m: string) => void }) {
  const bridge = buildNotesBridge();
  const [paths, setPaths] = useState<{ script: string; file: string; scriptExists: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void bridge?.paths().then((r) => { if (r.ok) setPaths(r); else setFailed(true); }, () => setFailed(true)); }, [bridge]);
  if (!bridge) return (
    <div className="stack-4">
      <h3 className="h3">Connect your LLM</h3>
      <p className="small">This works in the LoopStack desktop app. It gives you one command that lets Claude read your build notes from this Mac. Nothing to set up in this preview.</p>
    </div>
  );
  if (failed) return <p className="caption">Couldn’t find where this Mac keeps your build notes, so there is no connect command yet. Restart LoopStack and try again.</p>;
  if (!paths) return null;
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
  const command = `claude mcp add loopstack-buildnotes -- node ${q(paths.script)} ${q(paths.file)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setNote('Copied. Paste it into Terminal.'); announce('Copied the connect command.'); }
    catch { setNote('Copying isn’t available here.'); }
  };
  return (
    <div className="stack-8">
      <h3 className="h3">Connect your LLM</h3>
      <p className="small">Run this once in Terminal and Claude can read your build notes and confidence history from this Mac. It only reads. It can’t change anything in LoopStack, and it never touches your pump or your Loop.</p>
      <pre className="diff" tabIndex={0} aria-label="Connect command">{command}</pre>
      <div className="row wrap">
        <button type="button" className="quiet-btn" onClick={copy}>Copy command</button>
        {note && <span className="caption" role="status">{note}</span>}
      </div>
      {!paths.scriptExists && <p className="caption">The server script isn’t next to this app. Run LoopStack from your project folder, or point the command at scripts/buildnotes-mcp.mjs in your copy.</p>}
    </div>
  );
}
