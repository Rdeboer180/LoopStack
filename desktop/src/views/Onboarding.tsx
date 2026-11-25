// First-run setup: a full-window stepper in three calm steps: your data, your dashboard, then a quiet
// "you're set". Only "your data" is needed, and sample data counts (so nobody is stranded). Care team
// and the Ask & build tools are set up where they're used, not up front. Tokens and keys are typed by
// the person and saved by the bridges; nothing here stores, logs or puts them in the address.
import { useEffect, useRef, useState } from 'react';
import { PRESETS, PRESET_IDS, TILES, loadPreset, type PresetId } from '../layout/model';
import { DATA } from '../data/current';
import { STEPPER_IDS, closeSetup, goSetupStep, saveSetup, useSetup, useSetupUi, type StepperId } from '../data/setup';
import { showSample } from '../data/source';
import type { Go } from '../nav';
import { ICheck, useAnnounce } from '../ui/kit';
import { DataSource } from './Other';

const TITLE: Record<StepperId, string> = { data: 'Your data', dashboard: 'Your dashboard', done: 'You’re set' };

export function Onboarding({ onPreset, go }: { onPreset: (p: PresetId) => void; go: Go }) {
  const ui = useSetupUi();
  const { states, facts, refresh } = useSetup();
  const announce = useAnnounce();
  const head = useRef<HTMLHeadingElement>(null);
  const [picked, setPicked] = useState<PresetId>('everyday');
  const step = ui.step;
  const idx = STEPPER_IDS.indexOf(step);
  const haveData = states.data === 'done';

  // The connect panel changes things behind our back (it remounts the app): re-read what's connected now and then.
  useEffect(() => {
    if (!ui.open) return undefined;
    const t = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(t);
  }, [ui.open, refresh]);
  useEffect(() => { if (ui.open) head.current?.focus(); }, [ui.open, step]);
  // Esc sets setup aside, but only once there's data to look at: before that, "Look around with sample data" is the way out.
  useEffect(() => {
    if (!ui.open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && haveData) later(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.open, haveData]);
  if (!ui.open) return null;

  const later = () => { saveSetup({ closed: true }); closeSetup(); announce('Setup set aside. Settings keeps the checklist.'); };
  const to = (next: StepperId) => { goSetupStep(next); announce(`${TITLE[next]}, step ${STEPPER_IDS.indexOf(next) + 1} of ${STEPPER_IDS.length}.`); };
  const useLayout = () => { onPreset(picked); saveSetup({ layoutChosen: true }); announce(`${PRESETS[picked].name} layout chosen.`); to('done'); };
  const open = (view: 'review' | 'assistant' | 'library') => { saveSetup({ closed: true }); closeSetup(); go({ view }); };
  const sampleNow = DATA.source === 'synthetic';

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-h">
      <div className="setup-card">
        <header className="setup-head">
          <h1 className="h3">Set up LoopStack</h1>
          <ol className="setup-steps" aria-label={`Step ${idx + 1} of ${STEPPER_IDS.length}`}>
            {STEPPER_IDS.map((id, i) => (
              <li key={id} aria-current={id === step ? 'step' : undefined} className={id === step ? 'on' : i < idx ? 'done' : ''}>
                <span className="dot" aria-hidden="true">{i < idx ? <ICheck /> : i + 1}</span>
                <span className="lbl">{TITLE[id]}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className="setup-body stack-16">
          <h2 id="setup-h" className="title" tabIndex={-1} ref={head}><span className="sr-only">Step {idx + 1} of {STEPPER_IDS.length}, </span>{step === 'data' ? 'Show me my numbers' : step === 'dashboard' ? 'Choose a starting layout' : 'You’re set. Your dashboard is ready.'}</h2>

          {step === 'data' && (
            <>
              <p className="small">LoopStack reads your Nightscout and keeps everything on this Mac. It never changes your pump.</p>
              <DataSource variant="setup" />
              {/* Always here, errors included: nobody is stranded on this step. */}
              <section className="panel stack-8" aria-label="Look around first">
                <p className="lead-sm">Not ready to connect?</p>
                <p className="small">Look around with a made-up patient. None of your data is used, and you can connect any time from Settings.</p>
                <div><button type="button" className="quiet-btn" onClick={() => { showSample(); announce('Showing the sample patient.'); }}>Look around with sample data</button></div>
              </section>
            </>
          )}

          {step === 'dashboard' && (
            <>
              <p className="small">You can move, resize and add tiles any time from Edit layout.{sampleNow ? ' These are shown with sample numbers.' : ''}</p>
              <ul className="setup-presets" role="radiogroup" aria-label="Starting layouts">
                {PRESET_IDS.map((p) => (
                  <li key={p}>
                    <button type="button" role="radio" aria-checked={picked === p} className="setup-preset" onClick={() => setPicked(p)}>
                      <span className="strong">{PRESETS[p].name}</span>
                      <span className="small">{PRESETS[p].blurb}</span>
                      <span className="caption">{loadPreset(p).tiles.slice(0, 5).map((t) => TILES[t.id].title).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 'done' && (
            <>
              <p className="small">{sampleNow && !facts.nightscout ? 'You’re on sample data. Connect your Nightscout from Settings whenever you’re ready.' : 'Your numbers are on the dashboard.'} Three more things, each set up where you use it:</p>
              <ul className="setup-later">
                <li><div><span className="strong">Add your care team</span><span className="caption">Name and email, so Share and Email address them. LoopStack never contacts them.</span></div><button type="button" className="quiet-btn" onClick={() => open('review')}>Open Care-team review</button></li>
                <li><div><span className="strong">Ask about your numbers</span><span className="caption">Needs your own Anthropic key. Nothing is sent until you ask.</span></div><button type="button" className="quiet-btn" onClick={() => open('assistant')}>Open Ask & build</button></li>
                <li><div><span className="strong">Add features to your Loop</span><span className="caption">Needs your GitHub fork. Every change is shown and approved by you first.</span></div><button type="button" className="quiet-btn" onClick={() => open('library')}>Open Feature library</button></li>
              </ul>
            </>
          )}
        </div>

        <footer className="setup-foot">
          {idx > 0 && <button type="button" className="text-btn" onClick={() => to(STEPPER_IDS[idx - 1])}>Back</button>}
          <span className="spacer" />
          {haveData && step !== 'done' && <button type="button" className="quiet-btn" onClick={later}>Finish later</button>}
          {step === 'data' && <button type="button" className="cta glass-green" disabled={!haveData} aria-describedby={!haveData ? 'setup-need' : undefined} onClick={() => to('dashboard')}>Continue</button>}
          {step === 'dashboard' && <button type="button" className="cta glass-green" onClick={useLayout}>Use this layout</button>}
          {step === 'done' && <button type="button" className="cta glass-green" onClick={() => { saveSetup({ closed: true }); closeSetup(); announce('Setup finished.'); }}>Open my dashboard</button>}
        </footer>
        {step === 'data' && !haveData && <p id="setup-need" className="caption setup-need">Connect your Nightscout, or look around with sample data, to continue.</p>}
      </div>
    </div>
  );
}
