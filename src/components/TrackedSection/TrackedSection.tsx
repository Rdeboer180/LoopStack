import { useState } from 'react';
import { Section } from '@/components/Section/Section';
import { exportTransfer, importTransfer, useTracked } from '@/data/trackedStore';
import { gradeWord } from '@/lib/tracking/confidenceGrade';
import type { PortableItem } from '@/lib/tracking/transfer';
import styles from './TrackedSection.module.css';

const STATE_LABEL: Record<PortableItem['state'], string> = {
  tracked: 'Tracking',
  staged: 'Staged',
  built: 'Built',
  dismissed: 'Dismissed',
};

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The ids are the ones LoopStack makes ('isf', 'carbRatio', 'basal-07', 'food-pad-thai'); say them in words. */
function nameOf(id: string): string {
  if (id === 'isf') return 'Insulin sensitivity';
  if (id === 'carbRatio') return 'Carb ratio';
  const b = /^basal-(\d{2})$/.exec(id);
  if (b) {
    const h = Number(b[1]);
    return `Basal rate, ${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  }
  if (id.startsWith('food-')) {
    const f = id.slice(5).replace(/-/g, ' ');
    return `Favorite food: ${f}`;
  }
  return id;
}

function days(item: PortableItem): string {
  const n = item.history.length;
  return `${n} ${n === 1 ? 'day' : 'days'} tracked`;
}

export function TrackedSection() {
  const items = useTracked().filter((i) => i.state !== 'dismissed');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    const out = exportTransfer('LoopStack phone', todayIso());
    try {
      await navigator.clipboard.writeText(out);
      setFailed(false);
      setStatus('Copied.');
    } catch {
      window.prompt('Copy this confidence data:', out);
      setStatus('');
    }
  };

  const runImport = () => {
    const r = importTransfer(text);
    if (!r.ok) {
      setFailed(true);
      setStatus(r.error);
      return;
    }
    setFailed(false);
    setText('');
    setOpen(false);
    setStatus(
      r.added === 0 && r.updated === 0
        ? 'Nothing new in that copy.'
        : `Added ${r.added}, updated ${r.updated}.`,
    );
  };

  return (
    <Section
      label="Tracking"
      title="Suggestions you are tracking"
      description="What each one has read so far. This is a record of what was seen. It does not change anything in Loop."
    >
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing tracked on this phone yet. Track suggestions in the LoopStack desktop app, then use Copy confidence data there and Paste from another device here.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((i) => {
            const last = i.history[i.history.length - 1];
            return (
              <li key={i.id} className={styles.row}>
                <span className={styles.id}>{nameOf(i.id)}</span>
                <span className={styles.meta}>
                  {last ? gradeWord(last.confidence) : 'No reading yet'} · {days(i)} · {STATE_LABEL[i.state]}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.actions}>
        {items.length > 0 ? (
          <button type="button" className={styles.btn} onClick={copy}>
            Copy confidence data
          </button>
        ) : null}
        <button
          type="button"
          className={styles.btn}
          aria-expanded={open}
          aria-controls="tracked-paste"
          onClick={() => setOpen((o) => !o)}
        >
          Paste from another device
        </button>
      </div>

      {open ? (
        <div id="tracked-paste" className={styles.paste}>
          <label className={styles.label} htmlFor="tracked-paste-text">
            Paste what you copied on the other device
          </label>
          <textarea
            id="tracked-paste-text"
            placeholder="Paste here, then Import"
            className={styles.textarea}
            rows={5}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runImport} disabled={!text.trim()}>
            Import
          </button>
        </div>
      ) : null}

      <p className={failed ? styles.error : styles.status} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
        {status}
      </p>
    </Section>
  );
}
