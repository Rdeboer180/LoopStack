import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Section } from '@/components/Section/Section';
import { ConfidenceRing } from '@/components/ConfidenceRing/ConfidenceRing';
import {
  getFixLogItems,
  markFixLogImplemented,
  removeFixLogItem,
  useFixLog,
} from '@/data/fixLogStore';
import { commitFixLogItem, useCommitLog } from '@/data/commitLogStore';
import type {
  FixLogChangeKind,
  FixLogItem,
  FixLogSourceKind,
} from '@/data/types';
import { TrackedSection } from '@/components/TrackedSection/TrackedSection';
import { ChangeHandoff } from '@/components/ChangeHandoff/ChangeHandoff';
import { surfaceFor } from '@/lib/loop/changeSurface';
import { isPromoted } from '@/lib/loop/signalTier';
import { handoffForFix } from '@/lib/loop/changeSurface';
import styles from './FixLog.module.css';

const sourceLabel: Record<FixLogSourceKind, string> = {
  insight: 'Insight',
  memory: 'Memory',
  manual: 'Manual',
};

const changeKindLabel: Record<FixLogChangeKind, string> = {
  isf: 'ISF',
  carb_ratio: 'Carb ratio',
  absorption_window: 'Absorption',
  favorite_carbs: 'Favorite carbs',
  schedule_override: 'Schedule',
  timing_split: 'Timing split',
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

type FixItemCardProps = {
  item: FixLogItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onImplement: (id: string) => void;
  onRemove: (id: string) => void;
};

function FixItemCard({
  item,
  expanded,
  onToggle,
  onImplement,
  onRemove,
}: FixItemCardProps) {
  const implemented = item.status === 'implemented';

  return (
    <article
      className={`${styles.card} ${implemented ? styles.cardImplemented : ''}`}
    >
      <header className={styles.cardHead}>
        <div className={styles.cardHeadText}>
          <div className={styles.cardMeta}>
            <span className={styles.sourceChip}>{sourceLabel[item.source]}</span>
            <span className={styles.changeKindChip}>
              {changeKindLabel[item.change.kind]}
            </span>
            <span className={styles.cardTime}>{formatRelative(item.createdIso)}</span>
          </div>
          <h3 className={styles.cardTitle}>{item.title}</h3>
        </div>
        <ConfidenceRing
          level={item.confidence}
          score={item.confidenceScore}
          size="md"
          showLabel
        />
      </header>

      <div className={styles.change}>
        <div className={styles.changeRow}>
          <span className={styles.changeLabel}>{item.change.label}</span>
          <span className={styles.changeArrow} aria-hidden>→</span>
          <span className={styles.changeProposed}>{item.change.proposedValue}</span>
        </div>
        {item.change.currentValue !== item.change.proposedValue ? (
          <div className={styles.changeCurrent}>
            Current: {item.change.currentValue}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.whyToggle}
        onClick={() => onToggle(item.id)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide reasoning' : 'Why this?'}
        <span className={styles.whyToggleChevron} aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </button>

      {expanded ? (
        <div className={styles.reasoning}>
          <p className={styles.explanation}>{item.explanation}</p>
          {item.rationale.length > 0 ? (
            <ul className={styles.rationaleList}>
              {item.rationale.map((line, i) => (
                <li key={`${item.id}-r${i}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ChangeHandoff kind={item.change.kind} handoff={handoffForFix(item)} />

      {implemented ? (
        <div className={styles.implementedBadge}>
          <span aria-hidden>✓</span> Implemented — tracking outcome
        </div>
      ) : (
        <div className={styles.actions}>
          {/* Past tense, deliberately. "Implement in Loop" sits one tap from a
              screen that cannot touch Loop, and reads as though tapping it
              does the implementing. It does not: it records that the user
              already did, and starts the 14-day outcome window. */}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => onImplement(item.id)}
          >
            I made this in Loop
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => onRemove(item.id)}
          >
            Remove
          </button>
        </div>
      )}
    </article>
  );
}

export function FixLog() {
  const items = useFixLog();
  const commits = useCommitLog();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const staged = useMemo(
    () => items.filter((x) => x.status === 'staged'),
    [items],
  );
  const activeCommitCount = commits.filter(
    (c) => c.outcome.status !== 'reverted',
  ).length;

  // Show everything, but do not present it all as equally ready.
  //
  // A code-surface item is a request to edit Loop's source and rebuild, and the
  // absorption engine can raise one for every curve mismatch it notices. Left
  // in one flat list, fourteen of those bury the two settings changes that take
  // a minute to type in — and a list nobody reads is the same as no list.
  //
  // So the split is by what the item ASKS OF YOU, not by whether it is worth
  // knowing: anything below the promotion bar still renders, in full, one
  // heading down. Nothing is hidden and nothing is filtered away.
  const [leading, worthALook] = useMemo(() => {
    const lead: typeof staged = [];
    const rest: typeof staged = [];
    for (const item of staged) {
      (isPromoted(item.confidenceScore, surfaceFor(item.change.kind)) ? lead : rest).push(item);
    }
    return [lead, rest];
  }, [staged]);
  const implemented = useMemo(
    () => items.filter((x) => x.status === 'implemented'),
    [items],
  );

  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleImplement = (id: string) => {
    const fix = getFixLogItems().find((x) => x.id === id);
    if (!fix) return;
    commitFixLogItem(fix);
    markFixLogImplemented(id);
    navigate('/app/commitlog');
  };

  return (
    <>
      <AppHeader title="Fix Log" showBack />
      <main className="screen">
        <div className={styles.intro}>
          <p className={styles.introText}>
            Proposed changes staged from insights and memories. Review the reasoning,
            implement in Loop when you're ready — or remove if the signal fades.
          </p>
          <Link to="/app/commitlog" className={styles.commitLink}>
            <span className={styles.commitLinkLabel}>Commit Log</span>
            {/* Active commits, matching the badge Insights and the Inbox show.
                Counting reverted ones here made the same link read a different
                number on three screens. */}
            <span className={styles.commitLinkCount}>{activeCommitCount}</span>
            <span className={styles.commitLinkChevron} aria-hidden>→</span>
          </Link>
        </div>

        <Section
          label="Staged"
          title={`${leading.length} proposed change${leading.length === 1 ? '' : 's'}`}
          // "Tap Implement to commit it to Loop" described something the app
          // cannot do. LoopStack never writes to Loop — the button records
          // that YOU made the change, and starts the outcome clock. Each card
          // says where the change is actually made, just below.
          description="Nothing here has been applied. LoopStack cannot change Loop — make the change yourself, where the card says it lives, then mark it done to start the 14-day outcome tracking."
        >
          {leading.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>
                {worthALook.length > 0 ? 'Nothing needs you right now.' : 'No staged changes.'}
              </div>
              <div className={styles.emptyBody}>
                {worthALook.length > 0
                  ? 'Everything staged is below the bar for a rebuild. It is all still below, under "Worth a look".'
                  : 'Add an insight or memory pattern to the Fix Log to see it here.'}
              </div>
            </div>
          ) : (
            leading.map((item) => (
              <FixItemCard
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={toggle}
                onImplement={handleImplement}
                onRemove={removeFixLogItem}
              />
            ))
          )}
        </Section>

        {worthALook.length > 0 ? (
          <Section
            label="Worth a look"
            title={`${worthALook.length} more staged`}
            description="Real, and not urgent. Source changes wait here until the evidence is strong enough to be worth a rebuild — everything is still here to read, implement, or remove."
          >
            {worthALook.map((item) => (
              <FixItemCard
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={toggle}
                onImplement={handleImplement}
                onRemove={removeFixLogItem}
              />
            ))}
          </Section>
        ) : null}

        {implemented.length > 0 ? (
          <Section
            label="Implemented"
            title="Recently committed"
            description="Tracking outcomes for 14 days — results will feed back into confidence."
          >
            {implemented.map((item) => (
              <FixItemCard
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={toggle}
                onImplement={handleImplement}
                onRemove={removeFixLogItem}
              />
            ))}
          </Section>
        ) : null}

        <TrackedSection />
      </main>
    </>
  );
}
