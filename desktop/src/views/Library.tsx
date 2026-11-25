// The feature library: the person's own features first (their patches folder,
// each turned on and off by moving it to patches/off/), then Loop and Learn's
// customizations, added to their own Loop branch as reviewed patch files
// (PRODUCT.md SAFE-3, SAFE-6).
// Every card shows what it does and whether it changes dosing. Adding one
// means reading the full change; a dosing change needs a second confirmation;
// the main process enforces both again before it commits.
import { Diff } from '../ui/Diff';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATALOG_SOURCE, CUSTOMIZATIONS, customization, KNOWN_PERSONAL, personalFeature, WORKFLOW_ICONS, type PersonalFeature } from '../data/loopCustomizations';
import { githubBridge, setLoopBuild, useLoopBuild } from '../data/loopBuild';
import { libraryBridge, mineBridge, type CheckResult, type LibraryCommit, type LibraryItem, type MineItem, type MineMove } from '../data/library';
import { FeatureIcon } from '../ui/featureIcons';
import { Segmented, useAnnounce } from '../ui/kit';
import { YourLoop } from './Other';

type Filter = 'all' | 'display' | 'dosing';
type Step = 'review' | 'dosing' | 'done';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

export function Library() {
  const lib = libraryBridge();
  const gh = githubBridge();
  const build = useLoopBuild();
  const announce = useAnnounce();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [list, setList] = useState<{ sourceSha: string; items: LibraryItem[]; history: LibraryCommit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const mineApi = mineBridge();
  const [mine, setMine] = useState<MineItem[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [pickedMine, setPickedMine] = useState<string | null>(null);
  const [pickNonce, setPickNonce] = useState(0);
  // In one column (narrow windows) the detail sits below the list: bring it into view when something is picked.
  const showDetail = () => requestAnimationFrame(() => {
    if (!window.matchMedia('(max-width: 1180px)').matches) return;
    const el = document.querySelector<HTMLElement>('.lib-detail');
    el?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el?.focus({ preventScroll: true });
  });
  const pickLib = (id: string) => { setPicked(id); setPickedMine(null); showDetail(); };
  const pickMine = (file: string) => { setPickedMine(file); setPicked(null); setPickNonce((n) => n + 1); showDetail(); };

  // The fork is connected on this screen: once it is, the library loads without a reload.
  useEffect(() => {
    if (connected !== false || !gh) return undefined;
    const t = window.setInterval(() => { void gh.config().then((c) => { if (c.connected) { setConnected(true); void load(); } }); }, 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, gh]);

  const load = useCallback(async () => {
    if (!lib || !gh) return;
    const c = await gh.config();
    setConnected(c.connected);
    if (!c.connected) return;
    const [r, s, m] = await Promise.all([lib.list(), build ? Promise.resolve(null) : gh.status(), mineApi ? mineApi.list() : Promise.resolve(null)]);
    if (s && s.ok) setLoopBuild(s.status);
    if (m) { if (m.ok) { setMine(m.items); setMineError(null); } else setMineError(m.error); }
    if (r.ok) { setList(r); setError(null); } else setError(r.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, gh, mineApi]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    const by = new Map((list?.items ?? []).map((i) => [i.id, i]));
    return CUSTOMIZATIONS.filter((c) => c.offered && (filter === 'all' || (filter === 'dosing') === c.dosing)).map((c) => ({ c, item: by.get(c.id) ?? null }));
  }, [list, filter]);

  if (!lib || !gh) {
    return (
      <div className="page-cols">
        <section className="panel stack-12">
          <h2 className="title">Features for your Loop</h2>
          <p className="small">In the LoopStack desktop app, this is where your own features are turned on and off, and Loop and Learn’s customizations are added to your own Loop build, each one reviewed before it’s committed. This preview isn’t connected to a Loop.</p>
          <LibraryList items={items} onPick={pickLib} picked={picked} workflow={[]} />
        </section>
        <aside className="panel stack-8 lib-detail" tabIndex={-1} aria-label="Customization">
          {picked ? <><h3 className="h3">{customization(picked).name}</h3><p className="small">{customization(picked).what}</p><p className="caption">In the desktop app this shows the exact change, checked against your Loop.</p></> : <p className="small">Pick a feature to read about it.</p>}
        </aside>
      </div>
    );
  }
  if (connected === false) {
    // A preview until the Loop is connected: what the library holds, with no on/off state and nothing to change.
    return (
      <div className="feature-library">
        <section className="panel stack-12" aria-labelledby="lib-h">
          <h2 id="lib-h" className="title">Features for your Loop</h2>
          <p className="small preview-note"><b className="strong">Preview.</b> Connect your GitHub fork below to see which of these are in your build and turn them on and off. The library changes only your own LoopWorkspace branch, so it needs to know which one. Every change is shown to you first.</p>
          <YourLoop />
          <PreviewFeatures />
          <h3 className="h3 lib-section">Loop and Learn</h3>
          <LibraryList items={items} onPick={pickLib} picked={picked} workflow={[]} />
        </section>
        <aside className="panel stack-12 lib-detail" tabIndex={-1} aria-label="Customization">
          <p className="small">{picked ? 'Connect your Loop to see exactly what this changes in your code.' : 'Pick a feature to read about it. Once your Loop is connected, this shows the exact change.'}</p>
        </aside>
      </div>
    );
  }

  const workflow = build?.customizations ?? [];
  return (
    <div className="feature-library">
      <section className="panel stack-12" aria-labelledby="lib-h">
        <div className="row between wrap">
          <h2 id="lib-h" className="title">Features for your Loop</h2>
          <Segmented size="sm" label="Show" items={[{ value: 'all', label: 'All' }, { value: 'display', label: 'Display only' }, { value: 'dosing', label: 'Changes dosing' }]} value={filter} onChange={setFilter} />
        </div>
        {mineApi && <YourFeatures items={mine} error={mineError} workflow={workflow} picked={pickedMine} onPick={pickMine} />}
        <h3 className="h3 lib-section">Loop and Learn</h3>
        <p className="small">Loop and Learn’s customizations, for {build ? <b className="strong">{build.loopVersion ? `Loop ${build.loopVersion}` : 'your Loop'} on {build.owner}/{build.repo} · {build.branch}</b> : 'your Loop'}. Adding one commits its patch to your branch’s patches folder; your next build includes it.</p>
        {error && <p className="caption error" role="alert">{error}</p>}
        {!list && !error && <p className="small" role="status">Reading the library and your Loop…</p>}
        {list && <LibraryList items={items} onPick={pickLib} picked={picked} workflow={workflow} />}
        <p className="caption">Source: {CATALOG_SOURCE}{list ? ` @ ${list.sourceSha.slice(0, 7)}` : ''}. “Changes dosing” is LoopStack’s reading of each patch. Not offered: removing Face ID for bolus (no_auth), because it takes away a safety check.</p>
        {list && list.history.length > 0 && (
          <div className="stack-8">
            <span className="label">Changes to your patches folder</span>
            <ol className="lib-history">
              {list.history.map((h) => (
                <li key={h.sha}><a href={h.url} target="_blank" rel="noreferrer">{h.message}</a><span className="caption">{fmt(h.date)}{h.byLoopStack ? ' · by LoopStack' : ''}</span></li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <aside className="panel stack-12 lib-detail" tabIndex={-1} aria-label="Customization">
        {pickedMine && mine
          ? <MineDetail key={`${pickedMine}-${pickNonce}`} file={pickedMine} item={mine.find((m) => m.file === pickedMine) ?? null} all={mine} onChanged={() => { void load(); announce('Your Loop branch changed.'); }} />
          : picked && list
          ? <Detail key={picked} id={picked} sourceSha={list.sourceSha} item={list.items.find((i) => i.id === picked) ?? null} inWorkflow={workflow.includes(picked)} onChanged={() => { void load(); announce('Your Loop branch changed.'); }} />
          : <p className="small">Pick a feature to see exactly what it changes.</p>}
      </aside>
    </div>
  );
}

function LibraryList({ items, onPick, picked, workflow }: { items: { c: ReturnType<typeof customization>; item: LibraryItem | null }[]; onPick: (id: string) => void; picked: string | null; workflow: string[] }) {
  return (
    <ul className="lib-grid">
      {items.map(({ c, item }) => {
        const inBuild = item?.inPatches || workflow.includes(c.id);
        return (
          <li key={c.id}>
            <button type="button" className="lib-card" aria-pressed={picked === c.id} onClick={() => onPick(c.id)}>
              <span className="row between baseline"><span className="row baseline" style={{ gap: 8 }}><FeatureIcon name={WORKFLOW_ICONS[c.id] ?? 'library'} /><span className="strong">{c.name}</span></span>{inBuild && <span className="flag on">In your build</span>}</span>
              <span className="small">{c.what}</span>
              <span className="row wrap" style={{ gap: 6 }}>
                <span className={`flag${c.dosing ? ' dose' : ''}`}>{c.dosing ? 'Changes dosing' : 'Display only'}</span>
                {item && !item.variants.length && <span className="caption">No current version</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ id, sourceSha, item, inWorkflow, onChanged }: { id: string; sourceSha: string; item: LibraryItem | null; inWorkflow: boolean; onChanged: () => void }) {
  const lib = libraryBridge()!;
  const gh = githubBridge()!;
  const build = useLoopBuild();
  const c = customization(id);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('review');
  const [readIt, setReadIt] = useState(false);
  const [doseOk, setDoseOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commit, setCommit] = useState<{ sha: string; url: string; kind: 'added' | 'removed' } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [built, setBuilt] = useState(false);

  useEffect(() => {
    void lib.check({ id, sourceSha }).then((r) => (r.ok ? setCheck(r) : setError(r.error)));
  }, [lib, id, sourceSha]);

  const add = async () => {
    if (!check?.variant) return;
    setBusy(true);
    setError(null);
    const r = await lib.add({ id, sourceSha, variant: check.variant, reviewed: readIt, confirmDosing: c.dosing && doseOk });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCommit({ ...r.commit, kind: 'added' });
    setStep('done');
    onChanged();
  };
  const remove = async () => {
    setBusy(true);
    const r = await lib.remove({ id });
    setBusy(false);
    setRemoving(false);
    if (!r.ok) { setError(r.error); return; }
    setCommit({ ...r.commit, kind: 'removed' });
    setStep('done');
    onChanged();
  };
  const buildNow = async () => {
    const r = await gh.build();
    if (!r.ok) { setError(r.error); return; }
    setBuilt(true);
    window.setTimeout(() => { void gh.status().then((s) => s.ok && setLoopBuild(s.status)); }, 5000);
  };

  return (
    <>
      <div className="stack-4">
        <h3 className="h3">{c.name}</h3>
        <span className="row wrap" style={{ gap: 6 }}>
          <span className={`flag${c.dosing ? ' dose' : ''}`}>{c.dosing ? 'Changes dosing' : 'Display only'}</span>
          <span className="caption">{CATALOG_SOURCE}/{id}{check?.variant ? ` · ${check.variant.split('/')[1]}` : ''} · @ {sourceSha.slice(0, 7)}</span>
        </span>
        <p className="small">{c.what}</p>
      </div>
      {error && <p className="caption error" role="alert">{error}</p>}
      {step === 'done' && commit ? (
        <div className="stack-8" role="status">
          <p className="small ink">Committed to {build?.branch ?? 'your branch'}: <a href={commit.url} target="_blank" rel="noreferrer">{commit.sha?.slice(0, 7)}</a>. Your next build {commit.kind === 'removed' ? 'leaves it out' : 'includes it'}. Nothing changes on your phone until you install that build from TestFlight.</p>
          {built ? <p className="small">Build started. It takes 20 to 30 minutes.</p> : (
            <div className="row wrap">
              <button type="button" className="solid-btn" onClick={buildNow}>Build now</button>
              <span className="caption">or wait for Sunday’s build</span>
            </div>
          )}
        </div>
      ) : !check ? (
        !error && <p className="small" role="status">Checking it against your Loop…</p>
      ) : item?.inPatches ? (
        <div className="stack-8">
          <p className="small ink">In your build, from your branch’s patches folder.</p>
          {removing ? (
            <div className="row wrap" role="group" aria-label="Confirm removal">
              <button type="button" className="solid-btn" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove it from my branch'}</button>
              <button type="button" className="quiet-btn" onClick={() => setRemoving(false)}>Keep it</button>
            </div>
          ) : <div><button type="button" className="quiet-btn" onClick={() => setRemoving(true)}>Remove</button></div>}
        </div>
      ) : inWorkflow ? (
        <p className="small ink">In your build through your build workflow’s customization list. Change that list in GitHub; LoopStack doesn’t edit workflows.</p>
      ) : check.status === 'applied' ? (
        <p className="small ink">Your Loop’s code already has this change.</p>
      ) : check.status === 'conflict' ? (
        <p className="small ink">No version of this customization fits {build?.loopVersion ? `Loop ${build.loopVersion}` : 'your Loop'} yet. Loop and Learn update patches after a Loop release.</p>
      ) : (
        <>
          <div className="stack-4">
            <span className="label">What it changes</span>
            <ul className="lib-files">
              {check.files.map((f) => <li key={f.path}><code>{f.path}</code><span className="caption">{f.isNew ? 'new file' : `${f.added} added · ${f.removed} removed`}</span></li>)}
            </ul>
          </div>
          <Diff text={check.patch ?? ''} />
          {step === 'review' && (
            <div className="stack-8">
              <label className="check-row"><input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} /> I’ve read these changes</label>
              <div><button type="button" className="solid-btn" disabled={!readIt || busy} onClick={() => (c.dosing ? setStep('dosing') : add())}>{busy ? 'Committing…' : 'Add to my Loop branch'}</button></div>
            </div>
          )}
          {step === 'dosing' && (
            <div className="stack-8 dose-confirm" role="group" aria-labelledby="dose-h">
              <h3 id="dose-h" className="label">This changes how Loop doses</h3>
              <p className="small ink">{c.what} Once you install the build, Loop behaves differently from the version LoopKit released. Watch the first days on the new build, and tell your care team.</p>
              <label className="check-row"><input type="checkbox" checked={doseOk} onChange={(e) => setDoseOk(e.target.checked)} /> I understand this changes how Loop doses, and I’m choosing it</label>
              <div className="row wrap">
                <button type="button" className="solid-btn" disabled={!doseOk || busy} onClick={add}>{busy ? 'Committing…' : 'Commit it to my branch'}</button>
                <button type="button" className="quiet-btn" onClick={() => { setStep('review'); setDoseOk(false); }}>Back</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

const byRank = (a: { f: PersonalFeature; file: string }, b: { f: PersonalFeature; file: string }) => a.f.rank - b.f.rank || (a.file < b.file ? -1 : 1);

/** The person's own features, delayed metabolic response first, each with its switch; then what the build workflow adds. */
/** Your features as LoopStack knows them by name, before it can read your patches folder. */
function PreviewFeatures() {
  return (
    <div className="stack-8" aria-labelledby="mine-prev-h">
      <h3 id="mine-prev-h" className="h3 lib-section">Your features</h3>
      <ul className="mine-list">
        {KNOWN_PERSONAL.map((f) => (
          <li key={f.id} className="mine-row">
            <span className="mine-main static">
              <FeatureIcon name={f.icon} size={22} />
              <span className="stack-4" style={{ minWidth: 0 }}>
                <span className="strong">{f.name}</span>
                <span className="caption">{f.source}{f.bundle?.length ? ` · bundles ${f.bundle.length} more changes` : ''}</span>
                <span className="row wrap" style={{ gap: 6 }}>
                  {f.canTurnOn ? <span className={`flag${f.dosing ? ' dose' : ''}`}>{f.dosing ? 'Changes dosing' : 'Display only'}</span> : <span className="flag dose">Removes a safety check</span>}
                </span>
              </span>
            </span>
            <span className="caption mine-state">Connect to see</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YourFeatures({ items, error, workflow, picked, onPick }: { items: MineItem[] | null; error: string | null; workflow: string[]; picked: string | null; onPick: (file: string) => void }) {
  const rows = (items ?? []).map((m) => ({ ...m, f: personalFeature(m.file) })).sort(byRank);
  return (
    <div className="stack-8" aria-labelledby="mine-h">
      <div className="stack-4">
        <h3 id="mine-h" className="h3 lib-section">Your features</h3>
        <p className="small">From your branch’s patches folder. On means it’s in your next build; off moves it to patches/off, where it stays in your repo and out of the build.</p>
      </div>
      {error && <p className="caption error" role="alert">{error}</p>}
      {!items && !error && <p className="small" role="status">Reading your patches…</p>}
      {items && !rows.length && <p className="small">Your patches folder has none of your own patches yet.</p>}
      {rows.length > 0 && (
        <ul className="mine-list">
          {rows.map(({ file, on, f }) => (
            <li key={file} className={`mine-row${picked === file ? ' picked' : ''}`}>
              <button type="button" className="mine-main" aria-pressed={picked === file} onClick={() => onPick(file)}>
                <FeatureIcon name={f.icon} size={22} />
                <span className="stack-4" style={{ minWidth: 0 }}>
                  <span className="strong">{f.name}</span>
                  <span className="caption">{f.source}{f.bundle?.length ? ` · bundles ${f.bundle.length} more changes` : ''}</span>
                  <span className="row wrap" style={{ gap: 6 }}>
                    {f.canTurnOn ? <span className={`flag${f.dosing ? ' dose' : ''}`}>{f.dosing ? 'Changes dosing' : 'Display only'}</span> : <span className="flag dose">Removes a safety check</span>}
                  </span>
                </span>
              </button>
              <Switch label={f.name} on={on} onPress={() => onPick(file)} disabled={!on && !f.canTurnOn} />
            </li>
          ))}
          {workflow.map((id) => {
            const c = customization(id);
            return (
              <li key={`wf-${id}`} className="mine-row">
                <span className="mine-main static">
                  <FeatureIcon name={WORKFLOW_ICONS[id] ?? 'library'} size={22} />
                  <span className="stack-4" style={{ minWidth: 0 }}>
                    <span className="strong">{c.name}</span>
                    <span className="caption">Loop and Learn’s {id}, through your build workflow</span>
                    <span className="row wrap" style={{ gap: 6 }}><span className={`flag${c.dosing ? ' dose' : ''}`}>{c.dosing ? 'Changes dosing' : 'Display only'}</span></span>
                  </span>
                </span>
                <span className="flag on mine-state" title="Listed in your build workflow. LoopStack doesn’t edit workflows, so change it in GitHub.">On · workflow</span>
              </li>
            );
          })}
        </ul>
      )}
      {workflow.length > 0 && <p className="caption">Features marked “On · workflow” are listed in your build workflow’s customization list. LoopStack doesn’t edit workflows; change that list in GitHub.</p>}
    </div>
  );
}

/** An on/off switch whose state is the build's: pressing it opens the change to confirm, it doesn't flip on its own. */
function Switch({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${label}: ${on ? 'on' : 'off'}`} className={`switch${on ? ' on' : ''}`} onClick={onPress} disabled={disabled}>
      <span className="switch-knob" />
    </button>
  );
}

type MineStep = 'idle' | 'confirm-off' | 'review' | 'dosing' | 'done';

function MineDetail({ file, item, all, onChanged }: { file: string; item: MineItem | null; all: MineItem[]; onChanged: () => void }) {
  const api = mineBridge()!;
  const gh = githubBridge()!;
  const build = useLoopBuild();
  const f = personalFeature(file);
  const on = item?.on ?? false;
  const [step, setStep] = useState<MineStep>(on ? 'confirm-off' : 'review');
  const [check, setCheck] = useState<{ patch: string; files: CheckResult['files'] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<string[]>([]);
  const [readIt, setReadIt] = useState(false);
  const [doseOk, setDoseOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ moves: MineMove[]; commit: { sha: string; url: string } } | null>(null);
  const [built, setBuilt] = useState(false);
  const nameOf = (n: string) => personalFeature(n).name;

  useEffect(() => {
    if (on || !f.canTurnOn) return;
    void api.check({ file }).then((r) => (r.ok ? setCheck({ patch: r.patch, files: r.files }) : setError(r.error)));
  }, [api, file, on, f.canTurnOn]);

  const toggle = async (to: 'on' | 'off', together = false) => {
    setBusy(true);
    setError(null);
    setNeeds([]);
    const r = await api.toggle({ file, to, together, reviewed: readIt, confirmDosing: f.dosing && doseOk });
    setBusy(false);
    if (!r.ok) { setError(r.error); setNeeds(r.needs ?? []); return; }
    setDone({ moves: r.moves, commit: r.commit });
    setStep('done');
    onChanged();
  };
  const buildNow = async () => {
    const r = await gh.build();
    if (!r.ok) { setError(r.error); return; }
    setBuilt(true);
    window.setTimeout(() => { void gh.status().then((s) => s.ok && setLoopBuild(s.status)); }, 5000);
  };
  const neededOff = needs.filter((n) => all.some((m) => m.file === n && !m.on));

  return (
    <>
      <div className="stack-4">
        <div className="row baseline" style={{ gap: 10 }}><FeatureIcon name={f.icon} size={26} /><h3 className="h3">{f.name}</h3></div>
        <span className="row wrap" style={{ gap: 6 }}>
          <span className={`flag${on ? ' on' : ''}`}>{on ? 'On' : 'Off'}</span>
          {f.canTurnOn ? <span className={`flag${f.dosing ? ' dose' : ''}`}>{f.dosing ? 'Changes dosing' : 'Display only'}</span> : <span className="flag dose">Removes a safety check</span>}
          <span className="caption">{on ? 'patches' : 'patches/off'}/{file}</span>
        </span>
        <p className="small">{f.what}</p>
        <p className="caption">{f.source}</p>
        {f.note && <p className="small">{f.note}</p>}
      </div>
      {f.bundle && f.bundle.length > 0 && (
        <div className="stack-4">
          <span className="label">Also in this patch</span>
          <ul className="lib-files">{f.bundle.map((b) => <li key={b}><span className="small">{b}</span></li>)}</ul>
          <p className="caption">They turn on and off together. Splitting them into separate features is a follow-up.</p>
        </div>
      )}
      {error && (
        <div className="stack-8" role="alert">
          <p className="caption error">{error}</p>
          {needs.length > 0 && (on ? (
            <div className="stack-8">
              <p className="small ink">{needs.map(nameOf).join(', ')} {needs.length === 1 ? 'is' : 'are'} built on this patch and would stop applying without it.</p>
              <div className="row wrap"><button type="button" className="solid-btn" disabled={busy} onClick={() => toggle('off', true)}>{busy ? 'Turning off…' : `Turn off all ${needs.length + 1}`}</button></div>
            </div>
          ) : neededOff.length > 0 && <p className="small ink">Turn on {neededOff.map(nameOf).join(', ')} first.</p>)}
        </div>
      )}
      {step === 'done' && done ? (
        <div className="stack-8" role="status">
          <p className="small ink">Committed to {build?.branch ?? 'your branch'}: <a href={done.commit.url} target="_blank" rel="noreferrer">{done.commit.sha?.slice(0, 7)}</a>. Turned {done.moves.map((m) => `${m.to} ${nameOf(m.name)}`).join(', ')}. Nothing changes on your phone until you install the next build from TestFlight.</p>
          {built ? <p className="small">Build started. It takes 20 to 30 minutes.</p> : <div className="row wrap"><button type="button" className="solid-btn" onClick={buildNow}>Build now</button><span className="caption">or wait for Sunday’s build</span></div>}
        </div>
      ) : on ? (
        <div className="stack-8">
          <p className="small ink">On: in your next build.{f.canTurnOn ? '' : ' Turning it off brings the Face ID or passcode check back. LoopStack won’t turn it on again.'}</p>
          <p className="caption">Before it moves, LoopStack applies the patches that stay on, in order, to your Loop’s source, the way your build does. It doesn’t compile them.</p>
          <div className="row wrap"><button type="button" className="solid-btn" disabled={busy} onClick={() => toggle('off')}>{busy ? 'Checking and turning off…' : 'Turn it off'}</button></div>
        </div>
      ) : !f.canTurnOn ? (
        <p className="small ink">Off. LoopStack never turns this on: it removes a safety check.</p>
      ) : !check ? (
        !error && <p className="small" role="status">Reading the patch…</p>
      ) : (
        <>
          <div className="stack-4">
            <span className="label">What it changes</span>
            <ul className="lib-files">{check.files.map((x) => <li key={x.path}><code>{x.path}</code><span className="caption">{x.isNew ? 'new file' : `${x.added} added · ${x.removed} removed`}</span></li>)}</ul>
          </div>
          <Diff text={check.patch} />
          {step === 'review' && (
            <div className="stack-8">
              <label className="check-row"><input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} /> I’ve read these changes</label>
              <div><button type="button" className="solid-btn" disabled={!readIt || busy} onClick={() => (f.dosing ? setStep('dosing') : toggle('on'))}>{busy ? 'Checking and turning on…' : 'Turn it on'}</button></div>
            </div>
          )}
          {step === 'dosing' && (
            <div className="stack-8 dose-confirm" role="group" aria-labelledby="mine-dose-h">
              <h3 id="mine-dose-h" className="label">This changes how Loop doses</h3>
              <p className="small ink">{f.what} Once you install the build, Loop behaves differently from the version LoopKit released. Watch the first days on the new build, and tell your care team.</p>
              <label className="check-row"><input type="checkbox" checked={doseOk} onChange={(e) => setDoseOk(e.target.checked)} /> I understand this changes how Loop doses, and I’m choosing it</label>
              <div className="row wrap">
                <button type="button" className="solid-btn" disabled={!doseOk || busy} onClick={() => toggle('on')}>{busy ? 'Checking and turning on…' : 'Turn it on'}</button>
                <button type="button" className="quiet-btn" onClick={() => { setStep('review'); setDoseOk(false); }}>Back</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** The patch, line by line: additions and removals marked with + and − as well as colour (COL-5). */
