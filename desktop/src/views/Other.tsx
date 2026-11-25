// The patient's Changes and Settings pages. Settings is where Nightscout connects.
import type { Go } from '../nav';
import { isAppearance, type Appearance } from '../layout/saved';
import { openSetup, progressWords, STEP_IDS, STEP_TITLE, useSetup } from '../data/setup';
import { useEffect, useState, type FormEvent } from 'react';
import { DATA, LUNCH, PATIENT, PERIOD, READ, TEXT } from '../data/current';
import { bridge, loadNightscout, showSample, type NsConfig } from '../data/source';
import { customization } from '../data/loopCustomizations';
import { daysLeft, githubBridge, setLoopBuild, useLoopBuild, type LoopBuildStatus } from '../data/loopBuild';
import { aiBridge } from '../data/ai';
import { syncBridge } from '../data/buildNotes';
import { useAnnounce } from '../ui/kit';
import { PRESETS, type Layout } from '../layout/model';
import { useStore } from '../state';
import { BaChart, BaLegend } from '../tiles/faces';
import { ChangeTimeline } from './Review';
import { Basics, LearnedAboutYou, MacNotifications, YourLoopSettings, YourRanges } from './YourProfile';
import { rangeText } from '../data/ranges';

export function Changes() {
  return (
    <div className="page-cols">
      <section className="panel stack-12" aria-labelledby="ch-h">
        <h2 id="ch-h" className="title">Your settings changes</h2>
        <p className="small">Every change, who suggested it, who agreed and when you’ll look at it again. You make every change yourself in Loop.</p>
        <ChangeTimeline side="patient" />
      </section>
      <section className="panel stack-12" aria-labelledby="ba2-h">
        <h2 id="ba2-h" className="h3">Lunch, before and after</h2>
        <span className="caption">{LUNCH.change} · {LUNCH.usable.days} days each side, {LUNCH.usable.before} usable</span>
        <BaChart className="chart-md" />
        <BaLegend />
        <p className="small ink">{TEXT.lunchFinding} What happened, not proof the change did it.</p>
      </section>
    </div>
  );
}

export function Settings({ go, layout, onReset, appearance, onAppearance }: { go: Go; layout: Layout; onReset: () => void; appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const { packet } = useStore();
  return (
    <div className="page-cols">
      <SetupChecklist go={go} />
      <section className="panel stack-12" aria-labelledby="set-h">
        <h2 id="set-h" className="title">You and this Mac</h2>
        <dl className="facts">
          <div><dt>Person</dt><dd>{PATIENT.name}{DATA.source === 'synthetic' ? ', synthetic' : ''}</dd></div>
          <div><dt>System</dt><dd>{PATIENT.setup}</dd></div>
          <div><dt>Units</dt><dd>mg/dL · in range {rangeText()}</dd></div>
          <div><dt>Data</dt><dd>{PERIOD.label}, {READ.sensorWornPct}% sensor wear</dd></div>
          {DATA.source === 'synthetic' && <div><dt>Care team</dt><dd>{PATIENT.clinician} · {PATIENT.engagement.toLowerCase()}</dd></div>}
          <div><dt>Last packet</dt><dd>shared {packet.shared}</dd></div>
          <div><dt>Layout</dt><dd>{layout.preset === 'custom' ? 'Your own' : PRESETS[layout.preset].name} · saved on this computer</dd></div>
        </dl>
        <label className="style-pick settings-appearance">
          <span className="small strong">Appearance</span>
          <select value={appearance} onChange={(e) => { if (isAppearance(e.target.value)) onAppearance(e.target.value); }}>
            <option value="system">Match this Mac</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
        <ResetDashboard onReset={onReset} />
      </section>
      <YourRanges />
      <YourLoopSettings />
      <MacNotifications />
      <Basics />
      <LearnedAboutYou />
      <DataSource />
      <YourLoop />
      <AiConnector />
      <SyncFolder />
      <section className="panel stack-12" aria-labelledby="about-h">
        <h2 id="about-h" className="h3">About LoopStack</h2>
        <p className="small">The companion app for people who loop. Organize. Understand. Share.</p>
        <p className="small">Works with Loop · Trio · iAPS · AndroidAPS.</p>
        <p className="caption">Independent · not affiliated with LoopKit, Tidepool, Dexcom or Insulet · never changes your pump · changes to Loop only through your own reviewed build. {DATA.source === 'synthetic' ? ' Every number here is synthetic, made up for this demo.' : ' Your data is read from your Nightscout and kept on this computer.'}</p>
      </section>
    </div>
  );
}

/** Settings' way back into setup: each step and where it stands. */
function SetupChecklist({ go }: { go: Go }) {
  const { states } = useSetup();
  const done = STEP_IDS.filter((id) => states[id] === 'done').length;
  if (done === STEP_IDS.length) return null;
  return (
    <section className="panel stack-12" aria-labelledby="setup-list-h">
      <div className="row between wrap">
        <h2 id="setup-list-h" className="h3">{progressWords(states)}</h2>
        <button type="button" className="quiet-btn" onClick={() => openSetup(states.data === 'done' ? 'dashboard' : 'data')}>Open setup</button>
      </div>
      <ul className="setup-list">
        {STEP_IDS.map((id) => (
          <li key={id} className={states[id]}>
            <span className="setup-mark" aria-hidden="true">{states[id] === 'done' ? '✓' : states[id] === 'skipped' ? '–' : '○'}</span>
            <span className="strong">{STEP_TITLE[id]}</span>
            <span className="caption">{states[id] === 'done' ? 'done' : states[id] === 'skipped' ? 'skipped for now' : 'to do'}</span>
            {states[id] !== 'done' && <button type="button" className="text-btn" onClick={() => (id === 'care' ? go({ view: 'review' }) : id === 'tools' ? go({ view: 'assistant' }) : openSetup(id))}>Set up</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Reset asks once: it replaces the working dashboard (saved layouts are kept). */
function ResetDashboard({ onReset }: { onReset: () => void }) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  if (asking) return (
    <div className="row wrap" role="group" aria-label="Confirm reset">
      <p className="small">Reset your dashboard to the default layout? Saved layouts are kept.</p>
      <button type="button" className="quiet-btn" autoFocus onClick={() => { onReset(); setAsking(false); setDone(true); }}>Reset</button>
      <button type="button" className="text-btn" onClick={() => setAsking(false)}>Cancel</button>
    </div>
  );
  return (
    <div className="row wrap">
      <button type="button" className="quiet-btn" onClick={() => { setAsking(true); setDone(false); }}>Reset dashboard to default</button>
      {done && <span className="caption" role="status">Dashboard reset. Saved layouts were kept.</span>}
    </div>
  );
}

/** Connect the person's own Nightscout (desktop app only). Read-only, with a readable-role access token. */
export function DataSource({ variant }: { variant?: 'setup' } = {}) {
  const b = bridge();
  const announce = useAnnounce();
  const [cfg, setCfg] = useState<NsConfig | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<null | 'connect' | 'refresh'>(null);
  const [error, setError] = useState<string | null>(() => {
    try { const e = window.sessionStorage.getItem('loopstack.ns.error'); window.sessionStorage.removeItem('loopstack.ns.error'); return e; } catch { return null; }
  });

  useEffect(() => {
    if (!b) return;
    void b.config().then((c) => { setCfg(c); setUrl(c.url); setName(c.name); });
  }, [b]);

  if (!b) {
    return (
      <section className="panel stack-12" aria-labelledby="src-h">
        <h2 id="src-h" className="h3">Your data</h2>
        <p className="small">This preview shows a synthetic patient. The LoopStack desktop app reads your own Nightscout.</p>
      </section>
    );
  }

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('connect');
    setError(null);
    const res = await b.connect({ url, token, name });
    if (!res.ok) { setBusy(null); setError(res.error); return; }
    setToken('');
    announce('Connected. Reading your Nightscout.');
    try { await loadNightscout(); } catch (err) { setBusy(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const refresh = async () => {
    setBusy('refresh');
    setError(null);
    try { await loadNightscout(); } catch (err) { setBusy(null); setError(err instanceof Error ? err.message : String(err)); }
  };
  const disconnect = async () => {
    await b.disconnect();
    showSample();
    setCfg({ url: '', name: '', hasToken: false, connected: false });
    announce('Disconnected from Nightscout. Showing the sample patient.');
  };

  const live = DATA.source === 'nightscout';
  return (
    <section className="panel stack-12" aria-labelledby="src-h">
      <h2 id="src-h" className="h3">Your data</h2>
      <div className="ns-status small" role="status">
        <span className={`ns-dot${live ? ' on' : ''}`} aria-hidden="true" />
        {live
          ? <span>Reading <b className="strong">{DATA.sourceLabel}</b> · {PERIOD.label} · read {new Date(DATA.fetchedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          : cfg?.connected ? <span>Connected to {new URL(cfg.url).host}, showing the sample patient</span> : <span>Showing the sample patient</span>}
      </div>
      {variant !== 'setup' && (live || cfg?.connected) ? (
        <div className="row wrap">
          {live
            ? <button type="button" className="solid-btn" onClick={refresh} disabled={busy != null}>{busy === 'refresh' ? 'Reading…' : 'Read again'}</button>
            : <button type="button" className="solid-btn" onClick={refresh} disabled={busy != null}>{busy === 'refresh' ? 'Reading…' : 'Show my data'}</button>}
          {live && <button type="button" className="quiet-btn" onClick={showSample}>Show the sample patient</button>}
          <button type="button" className="quiet-btn" onClick={disconnect}>Disconnect</button>
        </div>
      ) : null}
      <form className="ns-form" onSubmit={connect} aria-label="Connect Nightscout">
        <label>Nightscout address
          <input type="url" inputMode="url" autoComplete="url" placeholder="https://yoursite.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
        <label>Access token
          <input type="password" autoComplete="off" placeholder={cfg?.hasToken ? 'Saved · leave blank to keep it' : 'Optional for an open site'} value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label>Your name, as LoopStack shows it
          <input type="text" autoComplete="given-name" maxLength={40} placeholder="Me" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div><button type="submit" className="solid-btn" disabled={busy != null}>{busy === 'connect' ? 'Connecting…' : cfg?.connected ? 'Save and read' : 'Connect'}</button></div>
      </form>
      {error && <p className="caption error" role="alert">{error}</p>}
      <details className="ns-how">
        <summary>How to make a read-only token</summary>
        <p className="caption">In Nightscout, open Admin tools → Subjects and add one with the readable role. Paste its token here. If you paste your API secret instead, LoopStack doesn’t use it.</p>
      </details>
      <p className="caption">A read-only pass you make in your Nightscout. It can’t change Nightscout, Loop or your pump. It’s saved on this Mac, locked with the Mac’s keychain; your readings stay in memory on this computer.</p>
    </section>
  );
}

// ------------------------------------------------------------ your Loop build (SAFE-3)

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function runWords(s: LoopBuildStatus): string {
  const r = s.latestRun;
  if (!r) return 'No builds yet';
  if (r.status !== 'completed') return `Building now, started ${fmtWhen(r.createdAt)}`;
  if (r.conclusion === 'success') return `Built ${fmtWhen(r.createdAt)} and sent to TestFlight`;
  if (r.conclusion === 'cancelled') return `Checked ${fmtWhen(r.createdAt)}: nothing new to build`;
  return `The build on ${fmtWhen(r.createdAt)} didn’t finish (${r.conclusion})`;
}

/** Connect the person's LoopWorkspace fork: read its version, customizations and builds, and start a build. */
export function YourLoop() {
  const b = githubBridge();
  const announce = useAnnounce();
  const status = useLoopBuild();
  const [connected, setConnected] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<null | 'connect' | 'read' | 'build'>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmBuild, setConfirmBuild] = useState(false);

  const read = async () => {
    if (!b) return;
    setBusy((x) => x ?? 'read');
    const r = await b.status();
    setBusy(null);
    if (r.ok) { setLoopBuild(r.status); setError(null); } else setError(r.error);
  };

  useEffect(() => {
    if (!b) return;
    void b.config().then((c) => {
      setConnected(c.connected);
      setRepo(c.owner ? `${c.owner}/${c.repo}` : '');
      setBranch(c.branch);
      if (c.connected && !status) void read();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b]);

  // While a build runs, look again every 30 seconds.
  const running = status?.latestRun && status.latestRun.status !== 'completed';
  useEffect(() => {
    if (!running) return undefined;
    const t = window.setInterval(() => { void read(); }, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!b) {
    return (
      <section className="panel stack-12" aria-labelledby="loop-h">
        <h2 id="loop-h" className="h3">Your Loop</h2>
        <p className="small">The LoopStack desktop app connects to your own Loop build on GitHub. This preview isn’t connected.</p>
      </section>
    );
  }

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('connect');
    setError(null);
    const r = await b.connect({ token, repo, branch });
    if (!r.ok) { setBusy(null); setError(r.error); return; }
    setToken('');
    setWarnings(r.warnings);
    setConnected(true);
    announce('Connected to your Loop on GitHub.');
    await read();
  };
  const build = async () => {
    setConfirmBuild(false);
    setBusy('build');
    const r = await b.build();
    if (!r.ok) { setBusy(null); setError(r.error); return; }
    announce('Build started. It takes 20 to 30 minutes.');
    // GitHub takes a few seconds to list a new run.
    window.setTimeout(() => { void read(); }, 5000);
    setBusy(null);
  };
  const disconnect = async () => {
    await b.disconnect();
    setLoopBuild(null);
    setConnected(false);
    setWarnings([]);
    announce('Disconnected from GitHub.');
  };

  const left = daysLeft(status);
  const custom = status ? [...status.customizations, ...status.patches.map((f) => f.replace(/\.(patch|diff)$/, ''))] : [];
  return (
    <section className="panel stack-12" aria-labelledby="loop-h">
      <h2 id="loop-h" className="h3">Your Loop</h2>
      {connected && status ? (
        <>
          <dl className="facts">
            <div><dt>Repository</dt><dd><a href={status.htmlUrl} target="_blank" rel="noreferrer">{status.owner}/{status.repo}</a> · {status.branch}</dd></div>
            <div><dt>Loop</dt><dd>{status.loopVersion ? `Loop ${status.loopVersion}` : 'Version not found'}</dd></div>
            <div><dt>Builds</dt><dd>{runWords(status)}</dd></div>
            <div><dt>TestFlight</dt><dd>{left == null ? 'No finished build to count from' : left < 0 ? `The last build expired ${fmtDate(status.testflightExpiresAt!)}` : `About ${left} days left, until ${fmtDate(status.testflightExpiresAt!)}`}</dd></div>
            <div><dt>Weekly build</dt><dd>{!status.workflow ? 'No “4. Build Loop” workflow found' : status.workflow.state === 'active' ? 'On: syncs on Sundays, builds when there’s something new and once a month' : 'Paused by GitHub. Builds still start with Build now.'}</dd></div>
          </dl>
          {left != null && left < 20 && <p className="small ink" role="status">{left < 0 ? 'Loop stops working when its TestFlight build expires. A new build replaces it.' : 'Loop starts warning 20 days before its TestFlight build expires.'}</p>}
          <div className="stack-4">
            <span className="label">Customizations in this build</span>
            {custom.length ? (
              <ul className="cust-list">
                {custom.map((id) => {
                  const c = customization(id);
                  return <li key={id}><span className="strong">{c.name}</span>{c.dosing && <span className="flag">Changes dosing</span>}<span className="caption">{c.what}</span></li>;
                })}
              </ul>
            ) : <p className="small">None. This is Loop as LoopKit released it.</p>}
          </div>
          {confirmBuild ? (
            <div className="stack-8" role="group" aria-label="Confirm build">
              <p className="small ink">Build {status.branch} as it is on GitHub now? It takes 20 to 30 minutes and puts a new build in TestFlight. Nothing changes on your phone until you install it.</p>
              <div className="row wrap">
                <button type="button" className="solid-btn" onClick={build}>Start the build</button>
                <button type="button" className="quiet-btn" onClick={() => setConfirmBuild(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="row wrap">
              <button type="button" className="solid-btn" onClick={() => setConfirmBuild(true)} disabled={busy != null || Boolean(running) || !status.workflow}>{running ? 'Building…' : busy === 'build' ? 'Starting…' : 'Build now'}</button>
              <button type="button" className="quiet-btn" onClick={read} disabled={busy != null}>{busy === 'read' ? 'Reading…' : 'Read again'}</button>
              <button type="button" className="quiet-btn" onClick={disconnect}>Disconnect</button>
            </div>
          )}
        </>
      ) : connected ? (
        <p className="small" role="status">{busy ? 'Reading your Loop on GitHub…' : 'Connected.'} <button type="button" className="text-btn" onClick={read}>Read again</button></p>
      ) : (
        <form className="ns-form" onSubmit={connect} aria-label="Connect your Loop on GitHub">
          <label>Your LoopWorkspace repository
            <input type="text" placeholder="your-name/LoopWorkspace" value={repo} onChange={(e) => setRepo(e.target.value)} autoComplete="off" />
          </label>
          <label>Branch
            <input type="text" placeholder="The default branch, usually main" value={branch} onChange={(e) => setBranch(e.target.value)} autoComplete="off" />
          </label>
          <label>GitHub token
            <input type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
          </label>
          <div><button type="submit" className="solid-btn" disabled={busy != null}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button></div>
        </form>
      )}
      {warnings.map((w) => <p key={w} className="caption" role="note">{w}</p>)}
      {error && <p className="caption error" role="alert">{error}</p>}
      {!connected && (
        <p className="caption">Make a fine-grained token in GitHub under Settings → Developer settings → Fine-grained tokens. Give it only your LoopWorkspace repository, with Contents and Actions set to read and write. LoopStack reads your build and can start one. It doesn’t need your signing secrets, and it doesn’t change your fork until you add a feature and approve its changes. The token is saved on this Mac, locked with the Mac’s keychain.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------ AI connector (SAFE-7)

export function AiConnector() {
  const ai = aiBridge();
  const announce = useAnnounce();
  const [cfg, setCfg] = useState<{ connected: boolean; model: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void ai?.config().then(setCfg); }, [ai]);
  if (!ai) return null;
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await ai.connect({ apiKey: key });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setKey('');
    setCfg({ connected: true, model: r.model });
    announce('Anthropic API key saved.');
  };
  const disconnect = async () => {
    await ai.disconnect();
    setCfg({ connected: false, model: cfg?.model ?? '' });
    announce('Anthropic API key removed.');
  };
  return (
    <section className="panel stack-12" aria-labelledby="ai-h">
      <h2 id="ai-h" className="h3">AI connector</h2>
      {cfg?.connected ? (
        <>
          <div className="ns-status small" role="status"><span className="ns-dot on" aria-hidden="true" /><span>Your Anthropic key is saved · {cfg.model}</span></div>
          <div className="row wrap"><button type="button" className="quiet-btn" onClick={disconnect}>Remove the key</button></div>
        </>
      ) : (
        <form className="ns-form" onSubmit={connect} aria-label="Add your Anthropic API key">
          <label>Anthropic API key
            <input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} required />
          </label>
          <div><button type="submit" className="solid-btn" disabled={busy}>{busy ? 'Checking…' : 'Save the key'}</button></div>
        </form>
      )}
      {error && <p className="caption error" role="alert">{error}</p>}
      <p className="caption">Used for Ask & build, billed to your Anthropic account (Claude Opus 5.5). Nothing is sent until you ask: a question sends a summary of your dashboard’s numbers, shown first; a feature request sends your description and the Loop files it needs. The key is saved on this Mac, locked with the Mac’s keychain. Checking the key sends none of your health data.</p>
    </section>
  );
}

/** Optional: keep your tracking in a folder so your other devices can read it. Off until you choose one. */
export function SyncFolder() {
  const sync = syncBridge();
  const announce = useAnnounce();
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void sync?.config().then((r) => setFolder(r.ok ? r.folder : null)); }, [sync]);
  if (!sync) return (
    <section className="panel stack-8" aria-labelledby="sync-h">
      <h2 id="sync-h" className="h3">Sync folder</h2>
      <p className="small">Choosing a sync folder works in the LoopStack desktop app. In this preview you can still use Copy confidence data and Paste from another device under Suggestions.</p>
    </section>
  );
  if (folder === undefined) return null;
  const choose = async () => {
    setError(null);
    const r = await sync.choose();
    if (!r.ok) { setError(r.error); return; }
    if (r.canceled) return;
    setFolder(r.folder);
    if (r.error) { setError(r.error); return; }
    announce('Sync folder chosen.');
  };
  const turnOff = async () => { await sync.clear(); setFolder(null); announce('Sync folder off.'); };
  return (
    <section className="panel stack-12" aria-labelledby="sync-h">
      <h2 id="sync-h" className="h3">Sync folder</h2>
      {folder ? (
        <>
          <p className="small">Your tracking is kept in <span className="strong" style={{ overflowWrap: 'anywhere' }}>{folder}</span> as one file per data source, named loopstack-tracked and the source. LoopStack reads and writes only those files there, and checks them when you come back to the app. Turning it off leaves the files where they are.</p>
          <div className="row wrap">
            <button type="button" className="quiet-btn" onClick={choose}>Choose another folder</button>
            <button type="button" className="quiet-btn" onClick={turnOff}>Turn off</button>
          </div>
        </>
      ) : (
        <>
          <p className="small">Choose a folder in iCloud Drive so your other devices can read it. It’s off until you pick one.</p>
          <div><button type="button" className="quiet-btn" onClick={choose}>Choose a folder</button></div>
        </>
      )}
      {error && <p className="caption error" role="alert">{error}</p>}
    </section>
  );
}
