import { useState } from 'react';
import { Section, Row } from '@/components/Section/Section';
import { EvidenceCard } from '@/components/EvidenceCard/EvidenceCard';
import type { DietaryPreferences as Prefs } from '@/data/types';
import { learnedRows, loadLearnedFeedback as loadFeedback, saveLearnedFeedback as persistFeedback, type LearnedFeedback } from '@/data/dietLabels';
import styles from './Profile.module.css';

/**
 * Read-only "what we've learned" summary. Replaces the old self-report diet form.
 *
 * As of the "derive, don't ask" repositioning, LoopStack no longer asks the user
 * to describe their diet — it infers the pattern from glucose, insulin, and meal
 * data (or, until the meal-trace engine lands, from a confirm-don't-fill default).
 * Nothing here is an input: the user confirms or nudges, they never fill a form.
 *
 * Feedback is persisted locally. "Confirmed" raises how much weight context
 * rules may carry; "flagged" tells the engine to treat these lines as
 * low-confidence until real meal data corroborates them.
 */

type Feedback = LearnedFeedback;

type Props = {
  dietary: Prefs;
};

export function LearnedProfile({ dietary }: Props) {
  const [feedback, setFeedback] = useState<Feedback>(loadFeedback);

  const give = (f: Exclude<Feedback, null>) => {
    // Tapping the active choice again clears it.
    const next = feedback === f ? null : f;
    setFeedback(next);
    persistFeedback(next);
  };

  return (
    <Section
      label="Derived · not entered"
      title="What we've learned about you"
      description="Detected from your glucose, insulin, and meal data — not typed in. These shape how LoopStack reads your curves. If something looks off, nudge it; you never fill this out."
    >
      {learnedRows(dietary).map(([label, value]) => (
        <Row key={label} label={label} value={value} />
      ))}

      <div className={styles.learnedActions}>
        <button
          type="button"
          className={`${styles.learnedConfirm} ${feedback === 'confirmed' ? styles.learnedActive : ''}`}
          onClick={() => give('confirmed')}
          aria-pressed={feedback === 'confirmed'}
        >
          {feedback === 'confirmed' ? 'Confirmed ✓' : 'Looks right'}
        </button>
        <button
          type="button"
          className={`${styles.learnedAdjust} ${feedback === 'flagged' ? styles.learnedActive : ''}`}
          onClick={() => give('flagged')}
          aria-pressed={feedback === 'flagged'}
        >
          {feedback === 'flagged' ? 'Flagged ✓' : "Something's off"}
        </button>
      </div>

      {feedback ? (
        <p className={styles.learnedAck}>
          {feedback === 'confirmed'
            ? 'Confirmed — LoopStack will keep verifying this against new meals.'
            : 'Noted — these lines are treated as low-confidence until more of your data confirms them.'}
        </p>
      ) : null}

      <EvidenceCard
        title="How your pattern shapes the curve"
        summary="Derived from your data + diabetes research"
        body={
          <>
            <p>
              A plant-forward, high-fiber, higher-carb pattern tends to produce a{' '}
              <strong>lower, broader post-meal rise</strong> without the long late
              tail that fat- and protein-heavy meals add. That moves the dial on
              bolus <strong>timing and duration</strong> more than bolus size.
            </p>
            <p>
              <strong>Fiber and resistant starch</strong> flatten and slow the
              early rise — favoring faster carb-absorption presets over the long
              extended curves high-fat meals need.
            </p>
            <p>
              Sustained higher-fiber, lower-saturated-fat eating is associated with{' '}
              <strong>higher insulin sensitivity</strong> over time, so observed
              ISF may drift above base. LoopStack watches for that drift rather
              than assuming it.
            </p>
            <p style={{ color: 'var(--ink-500)' }}>
              This is pattern context, not a prescription. Confirm any dosing or
              settings change with your care team.
            </p>
          </>
        }
      />
    </Section>
  );
}
