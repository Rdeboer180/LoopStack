import { useEffect, useRef, useState } from 'react';
import { applyView, deleteView, isAppearance, isDirty, renameView, saveNewView, updateView, type Workspace } from './saved';

/** Display preferences only. Health, account and therapy stores never enter this component. */
export function LayoutControls({ state, onChange, onReset, onClose }: {
  /** `undoLabel` marks a change that replaces the working view, so the app can offer one step of undo. */
  state: Workspace; onChange: (next: Workspace, undoLabel?: string) => void; onReset: () => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  // A status message belongs to the view it describes: once the layout changes, it no longer shows.
  const [message, setMessage] = useState<{ text: string; view: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = state.saved.find(v => v.id === state.activeId);
  const viewKey = (w: Workspace) => `${w.activeId}|${JSON.stringify(w.current)}`;
  useEffect(() => { heading.current?.focus(); }, []);
  const action = (run: () => Workspace, done: string, opts: { clearName?: boolean; undo?: string } = {}) => {
    try {
      const next = run();
      onChange(next, opts.undo);
      setError(''); setMessage({ text: done, view: viewKey(next) }); setDeleting(false);
      if (opts.clearName) setName('');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this layout. Try again.'); }
  };
  const dirty = !!active && isDirty(state);
  return (
    <section className="layout-controls" id="layout-controls" aria-labelledby="layouts-heading">
      <div className="row between">
        <div className="stack-4">
          <h2 id="layouts-heading" className="h3" tabIndex={-1} ref={heading}>Saved layouts</h2>
          <p className="small">Keep different views of your widgets. Changes stay in your working view until you update a saved layout.</p>
        </div>
        <button type="button" className="quiet-btn" onClick={onClose}>Close layouts</button>
      </div>
      <div className="layout-fields">
        <label className="stack-4">Appearance
          <select aria-label="Appearance" value={state.current.appearance} onChange={e => {
            if (isAppearance(e.target.value)) onChange({ ...state, current: { ...state.current, appearance: e.target.value } });
          }}>
            <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
          </select>
        </label>
        <label className="stack-4">Switch layout
          <select aria-label="Switch layout" value={state.activeId ?? ''} onChange={e => {
            const id = e.target.value;
            if (id) action(() => applyView(state, id), 'Saved layout applied.', { undo: dirty || !active ? 'Switched saved layout; your unsaved working view was replaced.' : 'Switched saved layout.' });
          }}>
            <option value="" disabled>Working view</option>
            {state.saved.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="stack-4">Layout name
          <input value={name} maxLength={60} placeholder={active ? `For example, ${active.name} 2` : 'For example, Evening'} onChange={e => setName(e.target.value)} />
        </label>
      </div>
      <p className="caption">{active ? `${active.name}${dirty ? ' has unsaved changes.' : ' matches your working view.'}` : 'Your working view is restored when you reopen the app.'} Order, size, visible widgets, hour-view settings and appearance only. No health data is saved here.</p>
      <div className="row wrap">
        <button type="button" className="solid-btn" onClick={() => action(() => saveNewView(state, name, crypto.randomUUID()), 'New layout saved.', { clearName: true })}>Save as new</button>
        <button type="button" className="quiet-btn" disabled={!dirty} onClick={() => action(() => updateView(state), 'Saved layout updated.')}>Update saved layout</button>
        <button type="button" className="text-btn" disabled={!dirty} onClick={() => action(() => applyView(state, active!.id), 'Saved layout restored.', { undo: 'Reverted to the saved layout.' })}>Revert changes</button>
        <button type="button" className="quiet-btn" disabled={!active || !name.trim()} title={active && !name.trim() ? 'Type the new name in Layout name first' : undefined} onClick={() => action(() => renameView(state, active!.id, name), 'Layout renamed.', { clearName: true })}>Rename</button>
        <button type="button" className="text-btn" disabled={!active} onClick={() => setDeleting(true)}>Delete layout</button>
        <button type="button" className="text-btn" onClick={() => { onReset(); setDeleting(false); setMessage(null); }}>Reset working view</button>
      </div>
      {deleting && active && <div className="row wrap" role="group" aria-label="Confirm layout deletion">
        <p className="small">Delete “{active.name}”? Your current widgets stay in place.</p>
        <button type="button" className="quiet-btn" onClick={() => action(() => deleteView(state, active.id), 'Saved layout deleted. Current widgets were kept.')}>Confirm delete</button>
        <button type="button" className="text-btn" onClick={() => setDeleting(false)}>Cancel</button>
      </div>}
      {state.saved.length === 0 && <p className="small">No saved layouts yet. Arrange your widgets, choose an appearance, then save a name.</p>}
      {error && <p role="alert" className="small">{error}</p>}
      <p role="status" className="caption">{message && message.view === viewKey(state) ? message.text : ''}</p>
    </section>
  );
}
