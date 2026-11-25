// Settings panels that mirror the phone's Profile: your glucose bands
// (Profile → Targets) and what LoopStack has learned about how you eat
// (Profile → What we've learned). Same fields, limits, words and storage keys
// as the phone, drawn with the desktop's own kit. Observations only (SAFE-1).
import { useState, type FormEvent } from 'react';
import { BANDS, isStandard, rangeText, resetBands, saveBands, STANDARD } from '../data/ranges';
import { therapyLimits } from '@/data/loopTherapyStore';
import { sampleUserProfile } from '@/data/userProfile';
import { learnedRows, loadLearnedFeedback, saveLearnedFeedback, type LearnedFeedback } from '@/data/dietLabels';
import { ALERT_CATEGORIES } from '@/lib/alerts/alertEngine';
import { loadNotificationPrefs, saveNotificationPrefs, type NotificationPrefs } from '@/data/notificationPrefs';
import { askMac, MAC_CATEGORIES, macPermission, macQueue, scheduleOnMac, showOnMac, type MacPermission } from '../data/notify';
import { DATA, PATIENT } from '../data/current';
import { Segmented } from '../ui/kit';

/** Urgent low, low and in range, read back first; Edit opens the three numbers the phone edits. */
export function YourRanges() {
  const [editing, setEditing] = useState(false);
  const [urgent, setUrgent] = useState(String(BANDS.urgentLow));
  const [low, setLow] = useState(String(BANDS.low));
  const [high, setHigh] = useState(String(BANDS.high));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const problem = saveBands({ urgentLow: Number(urgent), low: Number(low), high: Number(high) });
    if (problem) { setError(problem); return; }
    setError(null);
    setSaved(true);
    // Every reading is scored when the data loads, so the new bands take effect on a fresh read.
    window.location.reload();
  };
  const reset = () => { resetBands(); window.location.reload(); };
  const lim = therapyLimits;

  return (
    <section className="panel stack-12" aria-labelledby="ranges-h">
      <div className="row between wrap">
        <h2 id="ranges-h" className="h3">Your ranges</h2>
        <button type="button" className="quiet-btn" aria-pressed={editing} onClick={() => { setEditing((v) => !v); setError(null); }}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      <p className="small">How the dashboard scores your readings: in range, low and urgent low. The same bands as Profile → Targets on your phone. Changing them never changes Loop or your pump.</p>
      <dl className="facts">
        <div><dt>In range</dt><dd>{rangeText()} mg/dL</dd></div>
        <div><dt>Low</dt><dd>{BANDS.urgentLow}–{BANDS.low - 1} mg/dL</dd></div>
        <div><dt>Urgent low</dt><dd>under {BANDS.urgentLow} mg/dL</dd></div>
      </dl>
      {!isStandard() && <p className="caption">Your own bands. Standard reports score {STANDARD.low}–{STANDARD.high} with urgent low under {STANDARD.urgentLow}, so the dashboard won’t match Clarity or a clinic report. The care-team review keeps the standard bands.</p>}
      {editing && (
        <form className="ns-form" onSubmit={save} aria-label="Edit your ranges">
          <label>{lim.urgentLowMgdl.label}, mg/dL
            <input type="number" inputMode="numeric" min={lim.urgentLowMgdl.min} max={lim.urgentLowMgdl.max} step={1} value={urgent} onChange={(e) => setUrgent(e.target.value)} required aria-describedby="ranges-urgent-hint" />
          </label>
          <span id="ranges-urgent-hint" className="caption">Readings below this count as urgent low rather than low. Standard reports use 54; yours is what you treat differently.</span>
          <label>{lim.targetLowMgdl.label}, mg/dL
            <input type="number" inputMode="numeric" min={lim.targetLowMgdl.min} max={lim.targetLowMgdl.max} step={1} value={low} onChange={(e) => setLow(e.target.value)} required />
          </label>
          <label>{lim.targetHighMgdl.label}, mg/dL
            <input type="number" inputMode="numeric" min={lim.targetHighMgdl.min} max={lim.targetHighMgdl.max} step={1} value={high} onChange={(e) => setHigh(e.target.value)} required />
          </label>
          <div className="row wrap">
            <button type="submit" className="solid-btn">Save and read again</button>
            <button type="button" className="text-btn" onClick={reset}>Back to profile defaults</button>
          </div>
        </form>
      )}
      {error && <p className="caption error" role="alert">{error}</p>}
      {saved && <p className="caption" role="status">Saved. Reading your data again.</p>}
    </section>
  );
}

/** Read-only, as on the phone: derived context, never a form. Looks right / Something's off is all you do. */
export function LearnedAboutYou() {
  const d = sampleUserProfile.dietary;
  const [fb, setFb] = useState<LearnedFeedback>(loadLearnedFeedback);
  const give = (f: Exclude<LearnedFeedback, null>) => { const next = fb === f ? null : f; setFb(next); saveLearnedFeedback(next); };
  return (
    <section className="panel stack-12" aria-labelledby="learned-h">
      <h2 id="learned-h" className="h3">What we’ve learned about you</h2>
      <p className="small">How you eat, as your profile has it. Not typed in, and not a form. If something looks off, say so.</p>
      <dl className="facts">
        {learnedRows(d).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="row wrap" role="group" aria-label="Does this look right?">
        <button type="button" className="quiet-btn" aria-pressed={fb === 'confirmed'} onClick={() => give('confirmed')}>{fb === 'confirmed' ? 'Confirmed ✓' : 'Looks right'}</button>
        <button type="button" className="quiet-btn" aria-pressed={fb === 'flagged'} onClick={() => give('flagged')}>{fb === 'flagged' ? 'Flagged ✓' : 'Something’s off'}</button>
      </div>
      {fb && <p className="caption" role="status">{fb === 'confirmed' ? 'Confirmed. LoopStack keeps checking this against new meals.' : 'Noted. These lines are treated as low-confidence until more of your data backs them up.'}</p>}
      <p className="caption">Context only. No reading on this Mac uses it yet: Favorite foods and the suggestions come from your meals and glucose alone.</p>
    </section>
  );
}

// ------------------------------------------------------------ basics

type AgeRange = (typeof sampleUserProfile)['ageRange'];
type Routine = (typeof sampleUserProfile)['typicalRoutine'];
const AGES: { value: AgeRange; label: string }[] = [
  { value: '18-29', label: '18–29' }, { value: '30-44', label: '30–44' }, { value: '45-59', label: '45–59' }, { value: '60+', label: '60+' },
];
const ROUTINES: { value: Routine; label: string; hint: string }[] = [
  { value: 'regular_hours', label: 'Regular hours', hint: 'Sleep and meals at similar times daily' },
  { value: 'shift_work', label: 'Shift work', hint: 'Rotating or irregular sleep schedule' },
  { value: 'flexible', label: 'Flexible', hint: 'Weekdays steady, weekends shift' },
  { value: 'athlete', label: 'Athlete', hint: 'Training 4 or more times a week' },
];
const BASICS_KEY = 'loopstack:foundations:v1';
function loadBasics(): { ageRange: AgeRange; typicalRoutine: Routine } {
  const base = { ageRange: sampleUserProfile.ageRange, typicalRoutine: sampleUserProfile.typicalRoutine };
  try {
    const o = JSON.parse(localStorage.getItem(BASICS_KEY) ?? 'null') as Partial<typeof base> | null;
    return {
      ageRange: AGES.some((a) => a.value === o?.ageRange) ? o!.ageRange! : base.ageRange,
      typicalRoutine: ROUTINES.some((r) => r.value === o?.typicalRoutine) ? o!.typicalRoutine! : base.typicalRoutine,
    };
  } catch { return base; }
}

/** The phone's "About you": age range and typical routine, as two choices. */
export function Basics() {
  const [b, setB] = useState(loadBasics);
  const set = (next: typeof b) => { setB(next); try { localStorage.setItem(BASICS_KEY, JSON.stringify(next)); } catch { /* session only */ } };
  const routine = ROUTINES.find((r) => r.value === b.typicalRoutine)!;
  return (
    <section className="panel stack-12" aria-labelledby="basics-h">
      <h2 id="basics-h" className="h3">About you</h2>
      <p className="small">Slow-changing context, as on your phone. It describes you; no reading on this Mac changes because of it.</p>
      <div className="stack-4">
        <span className="small strong">Age range</span>
        <Segmented size="sm" label="Age range" items={AGES} value={b.ageRange} onChange={(ageRange) => set({ ...b, ageRange })} />
      </div>
      <div className="stack-4">
        <span className="small strong">Typical routine</span>
        <Segmented size="sm" label="Typical routine" items={ROUTINES.map(({ value, label }) => ({ value, label }))} value={b.typicalRoutine} onChange={(typicalRoutine) => set({ ...b, typicalRoutine })} />
        <span className="caption">{routine.hint}</span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ your Loop settings

const clock = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };

function Schedule({ title, unit, rows }: { title: string; unit: string; rows: readonly { startMinutes: number; text: string }[] }) {
  return (
    <table className="table">
      <caption className="small strong" style={{ textAlign: 'left' }}>{title}</caption>
      <thead><tr><th scope="col">From</th><th scope="col" className="num">{unit}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.startMinutes}><th scope="row">{clock(r.startMinutes)}</th><td className="num">{r.text}</td></tr>)}</tbody>
    </table>
  );
}

/**
 * Loop's settings as LoopStack reads them, read only. The phone keeps a hand-entered record; here they
 * come from your Nightscout profile, so there is nothing to type. Values Nightscout doesn't carry are
 * named as the phone's record. You change any of them in Loop, never here (SAFE-3).
 */
export function YourLoopSettings({ audience = 'patient' }: { audience?: 'patient' | 'clinician' }) {
  const t = DATA.THERAPY;
  const ns = t.from === 'nightscout';
  const fromPhone = ns ? ' · from the phone app’s record' : '';
  const saved = new Date(t.capturedIso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const clinician = audience === 'clinician';
  return (
    <section className="panel stack-12" aria-labelledby={clinician ? 'loopset-c-h' : 'loopset-h'}>
      {clinician
        ? <h3 id="loopset-c-h" className="label">Loop settings in effect · what Loop doses against</h3>
        : <h2 id="loopset-h" className="h3">Your Loop settings</h2>}
      <p className="small">{clinician
        ? `${ns ? `From ${PATIENT.first}’s Nightscout profile, saved ${saved}.` : 'The sample patient’s settings.'} These are Loop’s own settings, the values its automatic adjustments start from. ${PATIENT.first} changes them in Loop; LoopStack only reads them.`
        : `${ns ? `From your Nightscout profile, saved ${saved}.` : 'The sample patient’s settings, as the phone app records them.'} Read only: you change these in Loop. Suggestions measure against them.`}</p>
      <dl className="facts">
        <div><dt>Correction range</dt><dd>{t.correctionRange.map((r) => `${r.low}–${r.high}${t.correctionRange.length > 1 ? ` from ${clock(r.startMinutes)}` : ''}`).join(' · ')} mg/dL</dd></div>
        <div><dt>Pre-meal range</dt><dd>{t.preMealRange.low}–{t.preMealRange.high} mg/dL{fromPhone}</dd></div>
        <div><dt>Glucose safety limit</dt><dd>{t.glucoseSafetyLimitMgdl} mg/dL{fromPhone}</dd></div>
        <div><dt>Max basal · max bolus</dt><dd>{t.maxBasalRate} U/hr · {t.maxBolus} U{fromPhone}</dd></div>
        <div><dt>Insulin duration</dt><dd>{t.insulinDurationHours} h{fromPhone}</dd></div>
      </dl>
      <div className="loop-schedules">
        <Schedule title="Basal rates" unit="U/hr" rows={t.basalSchedule.map((e) => ({ startMinutes: e.startMinutes, text: e.value.toFixed(2) }))} />
        <Schedule title="Carb ratios" unit="g per U" rows={t.carbRatioSchedule.map((e) => ({ startMinutes: e.startMinutes, text: String(Math.round(e.value * 10) / 10) }))} />
        <Schedule title="Insulin sensitivity" unit="mg/dL per U" rows={t.insulinSensitivitySchedule.map((e) => ({ startMinutes: e.startMinutes, text: String(Math.round(e.value)) }))} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------ notifications

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** The phone's notification settings, with the queue on display; on the Mac they fire while LoopStack is open. */
export function MacNotifications() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadNotificationPrefs);
  const [perm, setPerm] = useState<MacPermission>(macPermission);
  const [tested, setTested] = useState<boolean | null>(null);
  const persist = (next: NotificationPrefs) => { setPrefs(next); saveNotificationPrefs(next); scheduleOnMac(next); };
  const turnOn = async () => { const p = await askMac(); setPerm(p); if (p === 'granted') persist({ ...prefs, enabled: true }); };
  const queue = prefs.enabled ? macQueue(prefs) : [];
  const time = `${String(prefs.reportAt.hour).padStart(2, '0')}:${String(prefs.reportAt.minute).padStart(2, '0')}`;
  return (
    <section className="panel stack-12" aria-labelledby="notif-h">
      <div className="row between wrap">
        <h2 id="notif-h" className="h3">Notifications</h2>
        <button type="button" role="switch" aria-checked={prefs.enabled} aria-label={`Notifications: ${prefs.enabled ? 'on' : 'off'}`} className={`switch${prefs.enabled ? ' on' : ''}`} disabled={perm === 'unavailable' || perm === 'denied'} onClick={() => (prefs.enabled ? persist({ ...prefs, enabled: false }) : void turnOn())}>
          <span className="switch-knob" />
        </button>
      </div>
      <p className="small">Heads-ups about patterns LoopStack has measured. Never a dose and never an instruction. On this Mac they arrive while LoopStack is open; your phone sends them whether or not it is.</p>
      {perm === 'denied' && <p className="caption error" role="alert">macOS has notifications for LoopStack turned off. Turn them on in System Settings → Notifications.</p>}
      <ul className="notif-cats">
        {ALERT_CATEGORIES.map((c) => {
          const mac = MAC_CATEGORIES.has(c.id);
          const on = mac && prefs.categories[c.id];
          return (
            <li key={c.id} className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
              <span className="stack-4"><span className="small strong">{c.label}</span><span className="caption">{mac ? c.description.replace('arrives whether or not the app is open', 'arrives while LoopStack is open on this Mac') : 'On your phone only for now: the Mac doesn’t run the engine behind it yet.'}</span></span>
              <button type="button" role="switch" aria-checked={on} aria-label={`${c.label}: ${on ? 'on' : 'off'}`} className={`switch${on ? ' on' : ''}`} disabled={!mac || !prefs.enabled} onClick={() => persist({ ...prefs, categories: { ...prefs.categories, [c.id]: !prefs.categories[c.id] } })}>
                <span className="switch-knob" />
              </button>
            </li>
          );
        })}
      </ul>
      <label className="style-pick">
        <span className="small strong">Morning report at</span>
        <input type="time" value={time} disabled={!prefs.enabled} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isInteger(h) && Number.isInteger(m)) persist({ ...prefs, reportAt: { hour: h, minute: m } }); }} />
      </label>
      {prefs.enabled && (
        <div className="row wrap">
          <button type="button" className="quiet-btn" onClick={() => setTested(showOnMac('LoopStack test', 'Notifications are on for this Mac.'))}>Send a test</button>
          {tested != null && <span className="caption" role="status">{tested ? 'Sent.' : 'macOS didn’t show it. Check System Settings → Notifications.'}</span>}
        </div>
      )}
      {prefs.enabled && (
        <div className="stack-4">
          <span className="small strong">Queued · {queue.length}</span>
          {queue.length ? (
            <ul className="notif-queue">
              {queue.slice(0, 8).map((a) => <li key={a.id}><span className="caption">{when(a.fireAtIso)}{a.repeatsWeekly || a.weeklyOn ? ' · weekly' : ''}</span><span className="small strong">{a.title}</span><span className="small">{a.body}</span></li>)}
            </ul>
          ) : <p className="caption">Nothing queued. A heads-up appears once three weeks of a weekday are on record.</p>}
        </div>
      )}
    </section>
  );
}
