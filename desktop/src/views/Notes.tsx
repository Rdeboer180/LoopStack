// Notes: everything captured while looking at the data, in one place to sort. Each note says what it was
// about (click the chip to go back to it) and keeps the numbers as they were. Send it to the endo, to
// LoopStack, both, or leave it; mark it done when it's been dealt with. "For my endo" notes show up in the
// care-team notes; "For LoopStack" notes are context only: they never change a reading, a grade or a build.
import { useState } from 'react';
import { destinationOf, filterNotes, unsortedCount, useNotes, type Note, type NoteFilter } from '../data/notes';
import { openFood } from '../data/intent';
import type { Go } from '../nav';
import { TileSelect, useAnnounce } from '../ui/kit';

const FILTERS: { value: NoteFilter; label: string }[] = [
  { value: 'unsorted', label: 'Unsorted' },
  { value: 'endo', label: 'For my endo' },
  { value: 'loopstack', label: 'For LoopStack' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (ms: number) => { const d = new Date(ms); const h = d.getHours(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };
const EMPTY: Record<NoteFilter, string> = {
  unsorted: 'Nothing waiting to be sorted. Add a note from a meal, or write one above.',
  endo: 'No notes for your endo yet. Mark a note “For my endo” and it shows in your care-team notes.',
  loopstack: 'No notes for LoopStack yet. They’re context only: they never change a reading or a build.',
  done: 'Nothing marked done yet.',
  all: 'No notes yet. Open a meal in Favorite foods and press Note, or write one above.',
};

export function Notes({ go }: { go: Go }) {
  const [notes, actions] = useNotes();
  const announce = useAnnounce();
  const [filter, setFilter] = useState<NoteFilter>(() => (unsortedCount(notes) > 0 ? 'unsorted' : 'all'));
  const [draft, setDraft] = useState('');
  const [undo, setUndo] = useState<string | null>(null);
  const shown = filterNotes(notes, filter);
  const count = (f: NoteFilter) => filterNotes(notes, f).length;

  const add = () => {
    if (!actions.add({ text: draft, anchor: null, snapshot: null })) return;
    setDraft(''); setFilter('unsorted'); announce('Note added.');
  };
  const archive = (n: Note) => { actions.setStatus(n.id, 'archived'); setUndo(n.id); announce('Note archived. Undo is available.'); };
  const toggleEndo = (n: Note) => { actions.setDestination(n.id, destinationOf({ forEndo: !n.forEndo, forLoopStack: n.forLoopStack })); };
  const toggleLoop = (n: Note) => { actions.setDestination(n.id, destinationOf({ forEndo: n.forEndo, forLoopStack: !n.forLoopStack })); };
  const back = (n: Note) => { if (n.anchor?.kind === 'meal') { openFood(n.anchor.food); go({ view: 'dashboard', tile: 'meals' }); } };

  return (
    <div className="notes stack-16">
      <section className="panel stack-12" aria-labelledby="notes-h">
        <div className="row between wrap">
          <h2 id="notes-h" className="title">Your notes</h2>
          <TileSelect label="Show" value={filter} options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} · ${count(f.value)}` }))} onChange={setFilter} />
        </div>
        <p className="small">What you noticed, kept with the numbers as they were. Send each one to your endo, to LoopStack, or both, whenever you’re ready. Nothing leaves this Mac from here.</p>
        <form className="note-quick" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="sr-only" htmlFor="note-quick">Write a note</label>
          <textarea id="note-quick" rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }} placeholder="Write a note. To attach one to a meal, open it in Favorite foods and press Note." />
          <button type="submit" className="quiet-btn" disabled={!draft.trim()}>Add note</button>
        </form>
        {undo && (
          <div className="undo-bar" role="group" aria-label="Undo">
            <span className="small">Note archived.</span>
            <button type="button" className="quiet-btn" onClick={() => { actions.setStatus(undo, 'open'); setUndo(null); announce('Note restored.'); }}>Undo</button>
            <button type="button" className="text-btn" onClick={() => setUndo(null)}>Dismiss</button>
          </div>
        )}
      </section>

      {shown.length === 0 ? <section className="panel"><p className="small">{EMPTY[filter]}</p></section> : (
        <ul className="note-list" aria-label={FILTERS.find((f) => f.value === filter)!.label}>
          {shown.map((n) => (
            <li key={n.id} className="panel stack-8">
              <div className="row between wrap">
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="caption">{when(n.at)}</span>
                  {n.anchor?.kind === 'meal'
                    ? <button type="button" className="note-chip link" onClick={() => back(n)} title="Open this meal">{n.anchor.food.replace(/^\p{Extended_Pictographic}[\p{Extended_Pictographic}️‍]*\s*/u, '')} · {when(n.anchor.at).replace(/, .*/, '')}</button>
                    : <span className="note-chip">Not tied to a meal</span>}
                </span>
                {n.status === 'done' && <span className="caption">Done</span>}
              </div>
              <p className="note-text">{n.text}</p>
              {n.snapshot && (
                <details className="note-snap">
                  <summary>The numbers then · {n.snapshot.source === 'synthetic' ? 'sample data' : n.snapshot.period}</summary>
                  <ul>{n.snapshot.lines.map((l) => <li key={l} className="small">{l}</li>)}</ul>
                </details>
              )}
              <div className="row wrap note-actions" role="group" aria-label="Who this is for">
                <button type="button" className="chip-toggle" aria-pressed={n.forEndo} onClick={() => toggleEndo(n)}>For my endo</button>
                <button type="button" className="chip-toggle" aria-pressed={n.forLoopStack} onClick={() => toggleLoop(n)}>For LoopStack</button>
                <span className="spacer" />
                {n.status === 'open'
                  ? <button type="button" className="text-btn" onClick={() => { actions.setStatus(n.id, 'done'); announce('Marked done.'); }}>Mark done</button>
                  : <button type="button" className="text-btn" onClick={() => actions.setStatus(n.id, 'open')}>Reopen</button>}
                <button type="button" className="text-btn" onClick={() => archive(n)}>Archive</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
