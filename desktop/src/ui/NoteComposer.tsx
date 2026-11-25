// A quiet "Note" on anything the person is looking at: opens a small composer that already knows what
// it's about (shown as a chip) and keeps a frozen snapshot of the numbers. Sorting can wait: the default
// is "Decide later", and the Notes tab is where notes get sent to the endo, to LoopStack, or both.
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNotes, MAX_TEXT, type Destination, type NoteAnchor, type NoteSnapshot } from '../data/notes';
import { IPlus, Segmented, useAnnounce } from './kit';

const DEST: { value: Destination; label: string; title: string }[] = [
  { value: 'none', label: 'Decide later', title: 'Keep it in Notes, unsorted' },
  { value: 'endo', label: 'For my endo', title: 'Shows in your care-team notes' },
  { value: 'loopstack', label: 'For LoopStack', title: 'Context on Suggestions; never changes a setting' },
  { value: 'both', label: 'Both', title: 'For your endo and for LoopStack' },
];

export function NoteButton({ anchor, snapshot, chip, onSaved }: { anchor: NoteAnchor; snapshot: NoteSnapshot; chip: string; onSaved?: () => void }) {
  const [, actions] = useNotes();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [dest, setDest] = useState<Destination>('none');
  const [saved, setSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const toggle = () => { setOpen((o) => !o); setSaved(false); requestAnimationFrame(() => area.current?.focus()); };
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!actions.add({ text, anchor, snapshot, destination: dest })) return;
    setText(''); setDest('none'); setOpen(false); setSaved(true);
    announce('Note saved. It’s in Notes.');
    onSaved?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
  return (
    <div className="note-wrap">
      <button type="button" className="text-btn note-btn" aria-expanded={open} onClick={toggle}><IPlus />Note</button>
      {saved && <span className="caption" role="status">Saved in Notes</span>}
      {open && (
        <form className="note-composer" onSubmit={save} aria-label="Add a note">
          <span className="note-chip">{chip}</span>
          <label className="sr-only" htmlFor="note-text">Your note</label>
          <textarea id="note-text" ref={area} rows={3} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="What did you notice? For example: felt shaky around 2h, ate the second half late." />
          <div className="row wrap">
            <Segmented size="sm" label="Who is this for" items={DEST} value={dest} onChange={setDest} />
          </div>
          <div className="row wrap">
            <button type="submit" className="quiet-btn" disabled={!text.trim()}>Save note</button>
            <button type="button" className="text-btn" onClick={() => setOpen(false)}>Cancel</button>
            <span className="caption">The numbers as they are now are saved with it. ⌘Enter saves.</span>
          </div>
        </form>
      )}
    </div>
  );
}
