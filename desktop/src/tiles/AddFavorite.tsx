// "Add to Loop favorites" from the meal response tile (step 3 of
// docs/desktop/loop-branch-plan.md). The person sets every value; LoopStack
// shows what they entered before and what glucose did, as information only
// (SAFE-5). Then the change to their Loop build, then the dosing confirmation
// (SAFE-3), both enforced again in the main process.
import { useEffect, useState, type FormEvent } from 'react';
import { ABSORPTION_CHOICES, favoritesBridge, splitFoodName, type FavoriteFood } from '../data/favorites';
import { githubBridge, setLoopBuild, useLoopBuild } from '../data/loopBuild';
import { dur, type MealGroup } from '../data/meals';
import { useAnnounce } from '../ui/kit';
import { Diff } from '../ui/Diff';

type Step = 'form' | 'review' | 'dosing' | 'done';

export function LoopFavorites({ group }: { group: MealGroup | null }) {
  const fav = favoritesBridge();
  const build = useLoopBuild();
  const [foods, setFoods] = useState<FavoriteFood[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!fav || !build) return;
    void fav.list().then((r) => r.ok && setFoods(r.foods));
  }, [fav, build]);
  if (!fav) return null;
  if (!build) return <p className="caption">Connect your Loop under Settings → Your Loop to add meals to Loop’s favorites.</p>;
  return (
    <div className="stack-8">
      {foods && foods.length > 0 && (
        <div className="stack-4">
          <span className="label">Added to Loop from LoopStack</span>
          <ul className="lib-files">{foods.map((f) => <li key={f.id}><span className="strong">{f.foodType} {f.name}</span><span className="caption">{f.grams} g · {dur(f.absorptionMin)}</span></li>)}</ul>
        </div>
      )}
      {group && !open && <div><button type="button" className="quiet-btn" onClick={() => setOpen(true)}>Add to Loop favorites</button></div>}
      {group && open && <AddFavorite key={group.name} group={group} onDone={(f) => setFoods(f)} onCancel={() => setOpen(false)} />}
    </div>
  );
}

function AddFavorite({ group, onDone, onCancel }: { group: MealGroup; onDone: (foods: FavoriteFood[]) => void; onCancel: () => void }) {
  const fav = favoritesBridge()!;
  const gh = githubBridge();
  const announce = useAnnounce();
  const split = splitFoodName(group.name);
  const [name, setName] = useState(split.name);
  const [foodType, setFoodType] = useState(split.foodType);
  const [grams, setGrams] = useState(String(group.medianCarbsG));
  const [absorption, setAbsorption] = useState(() => {
    const e = group.medianEnteredMin ?? 180;
    return ABSORPTION_CHOICES.reduce((b, c) => (Math.abs(c - e) < Math.abs(b - e) ? c : b), 180);
  });
  const [step, setStep] = useState<Step>('form');
  const [patch, setPatch] = useState('');
  const [readIt, setReadIt] = useState(false);
  const [doseOk, setDoseOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ sha: string; url: string } | null>(null);
  const [built, setBuilt] = useState(false);
  const food = (): FavoriteFood => ({ name, foodType, grams: Number(grams), absorptionMin: absorption });

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fav.preview({ food: food() });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPatch(r.patch);
    setStep('review');
  };
  const add = async () => {
    setBusy(true);
    setError(null);
    const r = await fav.add({ food: food(), reviewed: readIt, confirmDosing: doseOk });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCommit(r.commit);
    setStep('done');
    onDone(r.foods);
    announce(`${name} added to your Loop branch.`);
  };
  const buildNow = async () => {
    if (!gh) return;
    const r = await gh.build();
    if (!r.ok) { setError(r.error); return; }
    setBuilt(true);
    window.setTimeout(() => { void gh.status().then((s) => s.ok && setLoopBuild(s.status)); }, 5000);
  };

  return (
    <div className="stack-12 fav-add" role="group" aria-labelledby="fav-h">
      <h4 id="fav-h" className="label">Add to Loop favorites</h4>
      {step === 'form' && (
        <form className="ns-form" onSubmit={review} aria-label="The favorite">
          <div className="row wrap" style={{ gap: 12 }}>
            <label style={{ width: 90 }}>Food type<input type="text" value={foodType} onChange={(e) => setFoodType(e.target.value)} maxLength={8} placeholder="🌯" /></label>
            <label style={{ flex: 1, minWidth: 160 }}>Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label style={{ width: 120 }}>Carbs, g<input type="number" inputMode="decimal" min={1} max={250} step={0.5} value={grams} onChange={(e) => setGrams(e.target.value)} required /></label>
            <label style={{ flex: 1, minWidth: 160 }}>Absorption time
              <select value={absorption} onChange={(e) => setAbsorption(Number(e.target.value))}>
                {ABSORPTION_CHOICES.map((m) => <option key={m} value={m}>{dur(m)}</option>)}
              </select>
            </label>
          </div>
          <p className="caption">Before: you entered a median {group.medianCarbsG} g{group.medianEnteredMin != null ? ` with ${dur(group.medianEnteredMin)} absorption` : ''}, {group.n} times. {group.medianObservedMin != null ? `Absorbed in a median ${dur(group.medianObservedMin)}, counted the way Loop does (${group.observedN} of ${group.n}).` : 'No absorption time could be read yet.'} For your information; the values are yours to choose.</p>
          {error && <p className="caption error" role="alert">{error}</p>}
          <div className="row wrap">
            <button type="submit" className="solid-btn" disabled={busy}>{busy ? 'Preparing…' : 'Review the change'}</button>
            <button type="button" className="quiet-btn" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      )}
      {(step === 'review' || step === 'dosing') && (
        <>
          <p className="small">{foodType} {name}: {Number(grams)} g, {dur(absorption)}. LoopStack adds it to <code>loopstack/favorites.json</code> on your branch and updates one patch, which changes <code>UserDefaults+Loop.swift</code> when your Loop builds:</p>
          <Diff text={patch} />
          <p className="caption">On the first launch of that build, Loop adds it to your favorites once. If you edit or delete it on your phone, it stays that way. You still pick it and confirm every carb entry on your phone.</p>
          {error && <p className="caption error" role="alert">{error}</p>}
          {step === 'review' ? (
            <div className="stack-8">
              <label className="check-row"><input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} /> I’ve read this change</label>
              <div className="row wrap">
                <button type="button" className="solid-btn" disabled={!readIt} onClick={() => setStep('dosing')}>Add to my Loop branch</button>
                <button type="button" className="quiet-btn" onClick={() => setStep('form')}>Back</button>
              </div>
            </div>
          ) : (
            <div className="stack-8 dose-confirm" role="group" aria-labelledby="fav-dose-h">
              <h5 id="fav-dose-h" className="label">This prefills Loop’s carb screen</h5>
              <p className="small ink">Picking this favorite fills in {Number(grams)} g and {dur(absorption)} absorption, which Loop doses from once you save the entry. Check the numbers when you use it.</p>
              <label className="check-row"><input type="checkbox" checked={doseOk} onChange={(e) => setDoseOk(e.target.checked)} /> I understand this affects what Loop doses, and I chose these values</label>
              <div className="row wrap">
                <button type="button" className="solid-btn" disabled={!doseOk || busy} onClick={add}>{busy ? 'Committing…' : 'Commit it to my branch'}</button>
                <button type="button" className="quiet-btn" onClick={() => { setStep('review'); setDoseOk(false); }}>Back</button>
              </div>
            </div>
          )}
        </>
      )}
      {step === 'done' && commit && (
        <div className="stack-8" role="status">
          <p className="small ink">Committed: <a href={commit.url} target="_blank" rel="noreferrer">{commit.sha.slice(0, 7)}</a>. It reaches your favorites after your next build is installed from TestFlight.</p>
          {built ? <p className="small">Build started. It takes 20 to 30 minutes.</p> : (
            <div className="row wrap"><button type="button" className="solid-btn" onClick={buildNow}>Build now</button><span className="caption">or wait for Sunday’s build</span></div>
          )}
        </div>
      )}
    </div>
  );
}
