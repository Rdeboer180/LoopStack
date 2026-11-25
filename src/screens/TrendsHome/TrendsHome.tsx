import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFixLog } from '@/data/fixLogStore';
import { useCommitLog } from '@/data/commitLogStore';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { InboxButton } from '@/components/AppHeader/InboxButton';
import { ActivityStrip } from '@/components/ActivityStrip/ActivityStrip';
import { Section } from '@/components/Section/Section';
import { SampleNote, SampleTag } from '@/components/SampleTag/SampleTag';
import { HomeTabs, type HomeTab } from '@/components/HomeTabs/HomeTabs';
import { RiskWindowList } from '@/components/RiskWindowList/RiskWindowList';
import { ScopeButton } from '@/components/AppHeader/ScopeButton';
import { SampleScopePicker } from '@/components/SampleScopePicker/SampleScopePicker';
import {
  DEFAULT_SCOPE,
  scopeToRange,
  type SampleScope,
} from '@/data/sampleScope';
import { TimeInRangeBar } from '@/components/TimeInRangeBar/TimeInRangeBar';
import { MetricTile } from '@/components/MetricTile/MetricTile';
import { WeekRhythm } from '@/components/WeekRhythm/WeekRhythm';
import { InsulinLedgerCard } from '@/components/InsulinLedgerCard/InsulinLedgerCard';
import { observedRatio } from '@/lib/metabolism/insulinLedger';
import {
  isSample,
  useActivitySummary,
  useCurrentGlucose,
  useLoopMode,
  useMetrics,
  useTimeTrends,
  useInsulinLedger,
} from '@/data/sources/hooks';
import type { LoopModeSummary } from '@/lib/loop/loopMode';
import { useActivityStatus } from '@/lib/activity/useActivityStatus';
import {
  metricsDeltaReference,
  metricsRangeLabels,
  metricsRangePhrase,
  metricsRangeWindow,
} from '@/data/metrics';
import type { GlucoseMetrics, MetricsRange } from '@/data/types';
import { useRecentGlucose } from '@/data/sources/hooks';
import { GlanceView, type GlanceKey, type GlanceState } from '@/components/Glance/GlanceView';
import { buildPhoneGlance } from '@/components/Glance/phoneGlance';
import { useDataSourceContext } from '@/data/sources/DataSourceContext';
import styles from './TrendsHome.module.css';

const GLANCE_SOURCE: Record<string, string> = { mock: 'sample data', healthkit: 'Apple Health', nightscout: 'your Nightscout' };
/** Where each Glance tile goes on the phone. */
const GLANCE_OPENS: Record<GlanceKey, string> = {
  g: 'Insights',
  t: 'Glucose control, below',
  a: 'Glucose control, below',
  i: 'Treatment, below',
  w: 'Weekday hours',
  l: 'Weekday hours',
  d: 'Activity, below',
};

/**
 * Re-render on a timer so age-of-reading stays true while the screen is open.
 *
 * "2 min ago" and the Stale tag are both derived from `Date.now()` at render
 * time, and nothing re-rendered the hero: the data layer only publishes when a
 * source pushes, and no source polls. A phone left on this screen therefore
 * held "2 min ago" indefinitely while the reading behind it aged out, and the
 * Stale tag — the one thing that would have told the user not to trust the
 * number — could never appear, because appearing requires a render.
 *
 * A 30s tick is far cheaper than the reading it describes and costs nothing
 * when the tab is hidden.
 */
function useClockTick(intervalMs = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function TrendsHome() {
  const navigate = useNavigate();

  // The screen's sample, as one object. `range` is derived from it so every
  // metric lookup below keeps working unchanged — a weekday or explicit-date
  // scope still needs a contiguous window to read aggregates from, and that
  // window is the scope's outer span.
  const [scope, setScope] = useState<SampleScope>(DEFAULT_SCOPE);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [tab, setTab] = useState<HomeTab>('overview');
  const range: MetricsRange = scopeToRange(scope);
  // The coverage line is about the READINGS behind the sample, so it reads the
  // history rather than the single current value.
  const recentGlucoseResult = useRecentGlucose();
  const recentGlucoseTimestamps = useMemo(
    () => (recentGlucoseResult.data ?? []).map((r) => new Date(r.iso).getTime()),
    [recentGlucoseResult.data],
  );
  const metricsResult = useMetrics();
  const activityResult = useActivitySummary();
  const loopModeResult = useLoopMode();
  const glucoseResult = useCurrentGlucose();
  const trendsResult = useTimeTrends();
  // Rhythm strip follows the range selector — wide windows arrive already
  // bucketed into readable multi-day segments.
  const rhythm = trendsResult.data?.rhythmByRange?.[range] ?? null;
  const insulinLedgerResult = useInsulinLedger();
  const insulinLedger = insulinLedgerResult.data;
  const activity = useActivityStatus();

  const metrics = metricsResult.data?.[range] ?? null;
  const metricsSample = isSample(metricsResult);

  // Glance: the shared top component (src/components/Glance), the same one the
  // Mac dashboard leads with. It owns the loading, read-again, stale and failed
  // states; this screen only feeds it and says what each tile opens.
  const { refresh: refreshSource, activeKind } = useDataSourceContext();
  const [glanceReading, setGlanceReading] = useState(false);
  const [glanceError, setGlanceError] = useState<string | null>(null);
  useClockTick();
  const readAgain = async () => {
    setGlanceError(null);
    setGlanceReading(true);
    // A read that answers instantly still shows for half a second, so the tap is acknowledged.
    try { await Promise.all([refreshSource(), new Promise((r) => setTimeout(r, 500))]); } catch (e) { setGlanceError(e instanceof Error ? e.message : String(e)); } finally { setGlanceReading(false); }
  };
  const glanceModel = buildPhoneGlance({
    current: glucoseResult.data ?? null,
    sourceStale: glucoseResult.isStale,
    recent: recentGlucoseResult.data ?? [],
    metrics,
    closedLoopPct: loopModeResult.data?.closedLoopPct ?? null,
    rhythm,
    periodLabel: metricsRangeLabels[range],
    now: new Date(),
  });
  const glanceState: GlanceState = !glanceModel && (metricsResult.loading || glucoseResult.loading)
    ? 'loading'
    : glanceReading || (metricsResult.loading && metrics != null) ? 'refreshing' : 'ready';
  const openFromGlance = (k: GlanceKey) => {
    if (k === 'w' || k === 'l') { navigate('/app/weekday'); return; }
    if (k === 'g') { navigate('/app/insights'); return; }
    setTab(k === 'i' ? 'treatment' : 'overview');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('home-tabs')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const glance = (
    <GlanceView
      model={glanceModel}
      state={glanceState}
      loadingText="Reading your health data: glucose, insulin and activity…"
      sourceLine={metricsSample ? 'Sample data, made-up numbers' : `From ${GLANCE_SOURCE[activeKind] ?? 'your data'}`}
      error={glanceError ?? metricsResult.error?.message ?? null}
      errorTitle="Couldn’t read your data."
      onRetry={() => { void readAgain(); }}
      onRefresh={() => { void readAgain(); }}
      opens={GLANCE_OPENS}
      onOpen={openFromGlance}
      empty={{
        reason: 'Connect Apple Health or Nightscout and your glucose, insulin and activity show here.',
        action: <button type="button" className="gl-btn" onClick={() => navigate('/app/settings/sources')}>Connect a source</button>,
      }}
    />
  );
  // Two different facts, and the screen was missing both.
  //
  // WHAT A FIGURE MEASURES: the range selector governs some cards and not
  // others, and the ones it does NOT govern already name their own window
  // ("Today" on the insulin ledger, "last 14d" on Loop mode), so the governed
  // figures were the only unlabelled ones — exactly backwards.
  const windowWord = metricsRangeWindow[range];
  // Kept to one line at tile width: "avg over last 7 days" wrapped and made
  // every tile using it two rows taller.
  const perDay =
    range === 'today' ? 'today' : `per day · ${metricsRangeLabels[range]} avg`;

  // WHAT AN ARROW COMPARES TO: every up/down chip is a change against the
  // equal-length window before the selected one, and that was inferable only
  // from a selector three cards up.
  const deltaRef = metricsDeltaReference[range];
  const deltaCaption = metrics?.hasPriorWindow
    ? `↑ ↓ chips compare against ${deltaRef}.`
    : undefined;

  // Observed carb ratio, backed out of what was actually delivered: carbs ÷
  // (total insulin − scheduled baseline basal). Only when the source measures
  // delivered basal (not the bolus-only Nightscout path).
  const obs =
    metrics && insulinLedger?.hasBasal
      ? observedRatio({
          carbsPerDay: metrics.carbs,
          totalInsulinPerDay: metrics.totalInsulin,
          scheduledBasalPerDay: insulinLedger.scheduledBasalU,
        })
      : null;

  // Loading / empty gating for the dashboard as a whole.
  //
  // The selector renders here too. It used to be omitted, so any range with no
  // computed metrics replaced the dashboard with an empty state that had no
  // control to leave it — and '180d' was exactly that range, because it was
  // missing from ALL_RANGES. A dead end reached by tapping a button, explained
  // by a message about having no glucose history, on a device with months of it.
  if (!metrics) {
    return (
      <>
        <AppHeader
        centerAction={<ScopeButton scope={scope} onOpen={() => setScopeOpen(true)} />}
        rightAction={<InboxButton />}
      />
        <main className="screen">
          {glance}
          {/* Staged changes do not depend on metrics, and they are the one
              thing on this screen that is waiting on a decision — dropping
              them while the aggregates compute hid the actionable half of the
              screen behind the slowest half. */}
          <WaitingOnYou />
          {metricsResult.loading ? (
            <SectionSkeleton label="Computing metrics from your health data…" />
          ) : (
            <SectionSkeleton label="Nothing to show for this range yet — pick a shorter one, or give Apple Health time to sync more history." />
          )}
          <ActivityStrip activity={activity} />
        </main>
      </>
    );
  }

  return (
    <>
      {scopeOpen ? (
        <SampleScopePicker
          scope={scope}
          timestamps={recentGlucoseTimestamps}
          onApply={(next) => {
            setScope(next);
            setScopeOpen(false);
          }}
          onDismiss={() => setScopeOpen(false)}
        />
      ) : null}

      <AppHeader
        centerAction={<ScopeButton scope={scope} onOpen={() => setScopeOpen(true)} />}
        rightAction={<InboxButton />}
      />
      <main className="screen">
        {glance}

        <WaitingOnYou />

        {/* Everything above this line is unconditional: what my glucose is
            and what needs a decision. Only the analysis below
            is segmented. */}
        <div id="home-tabs" />
        <HomeTabs tab={tab} onChange={setTab} />

        {/* The old copy — "until Apple Health wiring lands" — described a state
            that ended: createHealthKitDataSource is implemented and registered
            (src/data/sources/registry.ts), and 'mock' is simply the default
            preference. So the note explained the wrong thing and offered no way
            to act on it, on the one screen where a person would want to. */}
        {tab !== 'overview' ? null : (
        <>
        {metricsSample ? (
          <SampleNote>
            Every figure below is example data.{' '}
            <button
              type="button"
              className={styles.sampleLink}
              onClick={() => navigate('/app/settings/sources')}
            >
              Connect a source
            </button>{' '}
            to see your own.
          </SampleNote>
        ) : null}

        <MetricsInsight metrics={metrics} range={range} sample={metricsSample} />

        {/* The bar and its three tiles carry no window of their own, so the
            label carries it for them; the description says what the chips are
            measured against. */}
        <Section label={`Glucose control · ${windowWord}`} description={deltaCaption}>
          <div className={styles.groupStack}>
            <TimeInRangeBar
              tir={metrics.tir}
              delta={metrics.deltas.inRange}
              targetLowMgdl={metrics.targetLowMgdl}
              targetHighMgdl={metrics.targetHighMgdl}
              urgentLowMgdl={metrics.urgentLowMgdl}
              deltaCompare={deltaRef}
            />
            <div className={styles.tileGrid}>
              <MetricTile
                label="Avg glucose"
                value={metrics.avgGlucose}
                unit="mg/dL"
                delta={metrics.deltas.avgGlucose}
                deltaSuffix=""
                deltaCompare={deltaRef}
              />
              <MetricTile
                label="Est. A1c"
                value={metrics.gmi}
                unit="%"
                delta={metrics.deltas.gmi}
                deltaSuffix=""
                deltaCompare={deltaRef}
                sublabel="GMI"
              />
              <MetricTile
                label="Variability"
                value={metrics.cv}
                unit="% CV"
                delta={metrics.deltas.cv}
                deltaSuffix=""
                deltaCompare={deltaRef}
                sublabel={`SD ${metrics.sd} mg/dL`}
              />
              <MetricTile
                label="Avg carbs"
                value={metrics.carbs}
                unit="g"
                sublabel={perDay}
              />
            </div>
          </div>
        </Section>

        {/* Rhythm for the selected window — the complement to the Insights
            day-of-week tab, placed right under the aggregate TIR so "how am I
            doing" is immediately followed by "when". */}
        {rhythm && rhythm.some((d) => d.tirPct != null) ? (
          <WeekRhythm
            days={rhythm}
            range={range}
            sample={isSample(trendsResult)}
            pooledInRangePct={metrics.tir.inRange}
          />
        ) : null}
        </>
        )}

        {tab !== 'treatment' ? null : (
        <>
        <Section label="Therapy" description={deltaCaption}>
          <div className={styles.tileGrid}>
            <MetricTile
              label="Insulin"
              value={metrics.totalInsulin}
              unit="U"
              delta={metrics.deltas.totalInsulin}
              deltaCompare={deltaRef}
              sublabel={perDay}
            >
              <InsulinSplit basal={metrics.basalInsulin} bolus={metrics.bolusInsulin} />
            </MetricTile>
            <MetricTile
              label="Bolus share"
              value={metrics.totalInsulin > 0
                ? Math.round((metrics.bolusInsulin / metrics.totalInsulin) * 100)
                : '—'}
              unit="%"
              // When the source reports no delivered basal, the denominator
              // uses the Loop schedule — say so rather than implying it was
              // measured.
              sublabel={
                metrics.basalIsScheduled
                  ? `${metrics.bolusInsulin}U of ${metrics.totalInsulin}U · basal from schedule`
                  : `${metrics.bolusInsulin}U of ${metrics.totalInsulin}U`
              }
            />
            {/* Xtra insulin + observed carb ratio: what the day needed beyond the
                scheduled baseline basal, and the g/U that xtra actually covered.
                Needs delivered basal, so hidden on the bolus-only Nightscout
                source. Range-aware — select "Today" for today, "7d" for a stable
                read. */}
            {obs && obs.xtraU > 0 ? (
              <>
                <MetricTile
                  label="Xtra insulin"
                  value={obs.xtraU}
                  unit="U"
                  sublabel={`total − ${Math.round(insulinLedger!.scheduledBasalU)}U basal`}
                />
                {obs.ratio != null ? (
                  <MetricTile
                    label="Obs. carb ratio"
                    value={obs.ratio}
                    unit="g/U"
                    sublabel="carbs ÷ xtra insulin"
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </Section>

        {/* Loop's automatic micro-dosing, accumulated by hour — today only. */}
        {insulinLedger ? (
          <InsulinLedgerCard ledger={insulinLedger} sample={isSample(insulinLedgerResult)} />
        ) : null}

        </>
        )}

        {tab !== 'patterns' ? null : (
        <>
        {/* What repeats, leading with the engine that was reachable only
            through notification settings. */}
        <RiskWindowList />

        <Section label="Activity & recovery">
          <div className={styles.tileGrid}>
            <MetricTile
              label="Steps"
              value={metrics.steps.toLocaleString()}
              sublabel={perDay}
            />
            <MetricTile
              label="Sleep"
              value={metrics.sleepHours}
              unit="h"
              sublabel={perDay}
            />
            {/* Composite exercise: recorded workouts + sustained HR elevation +
                step bursts, deduplicated — activity counts even when no workout
                was logged. */}
            <MetricTile
              label="Exercise"
              value={activityResult.data?.compositeExerciseMinutes ?? metrics.exerciseMinutes}
              unit="min"
              sublabel={
                activityResult.data
                  ? `last ${activityResult.data.windowHours}h · workouts + HR + steps`
                  : perDay
              }
            />
            {activityResult.data?.avgDropMgdl != null ? (
              <MetricTile
                label="Glucose response"
                value={`−${activityResult.data.avgDropMgdl}`}
                unit="mg/dL"
                sublabel={`avg fall after activity · nadir ~${activityResult.data.avgMinutesToNadir} min · ${activityResult.data.respondedEventCount} events`}
              />
            ) : (
              <MetricTile
                label="Glucose response"
                value="—"
                sublabel="Building — needs activity events with glucose after them"
              />
            )}
          </div>
          {activityResult.data && isSample(activityResult) ? (
            <SampleNote>Activity figures are example data.</SampleNote>
          ) : null}
        </Section>

        <Section label="Loop mode">
          <LoopModeCard result={loopModeResult} />
        </Section>

        <ActivityStrip activity={activity} />
        </>
        )}
      </main>
    </>
  );
}

function MetricsInsight({
  metrics,
  range,
  sample,
}: {
  metrics: GlucoseMetrics;
  range: MetricsRange;
  sample: boolean;
}) {
  const phrase = metricsRangePhrase[range];
  // Report what the window actually holds. `daysInWindow` is what was asked
  // for, so a 180-day selection over 90 days of history labelled itself
  // "Based on 180 days" while averaging half that.
  const days = metrics.daysCovered || metrics.daysInWindow;
  const short = metrics.daysCovered > 0 && metrics.daysCovered < metrics.daysInWindow;
  const daysLabel =
    range === 'today'
      ? 'Today so far'
      : short
        ? `Based on ${days} days — all the history available`
        : `Based on ${days} days`;

  // A comparison can only be claimed when there was something to compare to.
  // Deltas go neutral both for "unchanged" and for "no prior window", so the
  // else-branch below asserted "holding steady vs the prior 90 days" about a
  // comparison that never happened — beside a badge reading "Measured".
  let headline: string;
  if (!metrics.hasPriorWindow) {
    headline = `${metrics.tir.inRange}% in range across ${days} days. No earlier stretch to compare this against yet.`;
  } else if (metrics.deltas.inRange.value > 0) {
    headline = `Time in range is up ${metrics.deltas.inRange.value}% vs the ${phrase} — ${metrics.tir.inRange}% in range now.`;
  } else if (metrics.deltas.avgGlucose.direction === 'good') {
    headline = `Average glucose is down ${Math.abs(metrics.deltas.avgGlucose.value)} mg/dL vs the ${phrase}.`;
  } else {
    headline = `Your control is holding steady vs the ${phrase}.`;
  }

  return (
    <section className={styles.insightCard}>
      <span className="label">Trend</span>
      <h2 className={styles.insightHeadline}>{headline}</h2>
      <div className={styles.insightMeta}>
        {/* Sample data never carries a confidence badge; computed data states
            its evidence base plainly (the window it was measured over). */}
        {sample ? (
          <SampleTag />
        ) : (
          <span className={styles.badge}>Measured</span>
        )}
        <span className={styles.muted}>{daysLabel}</span>
      </div>
    </section>
  );
}

// Closed-loop vs manual time + override outcomes. Empty state names its real
// dependency: this signal only exists via the Nightscout source.
function LoopModeCard({
  result,
}: {
  result: ReturnType<typeof useLoopMode>;
}) {
  const lm: LoopModeSummary | null = result.data;

  // The engine emits one suggestion per override it judged 'review', worded as
  // `"Name" override: <note>` — the same note the override row above already
  // prints under its REVIEW badge. Both lists render on this card, so every
  // reviewable override said the same sentence twice, a screen apart.
  //
  // Dropped here rather than in computeLoopMode(): that function's suggestion
  // list is a tested contract, and the row is the better of the two
  // presentations because it carries the name and the verdict as structure
  // instead of restating them in prose.
  const suggestions =
    lm?.suggestions.filter((s) => !lm.overrideOutcomes.some((o) => s.endsWith(o.note))) ?? [];

  if (!lm) {
    return (
      <p className={styles.loopEmpty}>
        {result.loading
          ? 'Reading Loop status…'
          : result.error
            ? result.error.message
            : 'Closed-loop tracking needs the Nightscout source — Loop posts its status there, not to Apple Health. Connect it under Profile → Sources.'}
      </p>
    );
  }

  return (
    <div className={styles.groupStack}>
      <div className={styles.tileGrid}>
        <MetricTile
          label="Closed loop"
          value={lm.closedLoopPct}
          unit="%"
          sublabel={`last ${lm.windowDays}d`}
        />
        <MetricTile
          label="Manual time"
          value={lm.manualMinutesPerDay}
          unit="min/day"
          sublabel={
            lm.manualEpisodeCount > 0
              ? `${lm.manualEpisodeCount} episodes · longest ${lm.longestManualMinutes} min`
              : 'no manual episodes'
          }
        />
      </div>

      {lm.overrideOutcomes.length > 0 ? (
        <div className={styles.overrideList}>
          {lm.overrideOutcomes.map((o) => (
            <div key={o.name} className={styles.overrideRow}>
              <div className={styles.overrideHead}>
                <span className={styles.overrideName}>{o.name}</span>
                <span
                  className={`${styles.overrideVerdict} ${styles[`overrideVerdict_${o.verdict}`]}`}
                >
                  {o.verdict === 'working'
                    ? 'Working'
                    : o.verdict === 'review'
                      ? 'Review'
                      : 'Building'}
                </span>
              </div>
              <p className={styles.overrideNote}>{o.note}</p>
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className={styles.loopSuggestions}>
          {suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}

      {isSample(result) ? (
        <SampleNote>Loop-mode figures are example data.</SampleNote>
      ) : null}
    </div>
  );
}

function InsulinSplit({ basal, bolus }: { basal: number; bolus: number }) {
  const total = Math.max(1, basal + bolus);
  return (
    <div>
      <div className={styles.splitBar} role="img" aria-label={`Basal ${basal}U, bolus ${bolus}U`}>
        <div className={styles.splitBasal} style={{ width: `${(basal / total) * 100}%` }} />
        <div className={styles.splitBolus} style={{ width: `${(bolus / total) * 100}%` }} />
      </div>
      <div className={styles.splitLegend}>
        <span className={styles.splitItem}>
          <span className={`${styles.splitDot} ${styles.splitBasal}`} />
          Basal {basal}U
        </span>
        <span className={styles.splitItem}>
          <span className={`${styles.splitDot} ${styles.splitBolus}`} />
          Bolus {bolus}U
        </span>
      </div>
    </div>
  );
}

/**
 * The one thing on this screen that is waiting for a decision.
 *
 * Everything else on Trends is a read-only aggregate. The Fix Log is where the
 * app's entire pipeline ends — a change for the user to make in Loop — and it
 * had no presence here at all: reaching it meant Insights, then a tab labelled
 * "Meal trends", then Fix log. Three taps, behind a name that describes one of
 * the four things that tab holds, while the home screen gave its whole surface
 * to numbers that ask nothing of anyone.
 *
 * Renders nothing when there is nothing staged, so it stays a signal rather
 * than furniture.
 */
function WaitingOnYou() {
  const navigate = useNavigate();
  const fixLog = useFixLog();
  const commits = useCommitLog();
  const staged = fixLog.filter((i) => i.status === 'staged').length;
  const tracking = commits.filter((c) => c.outcome?.status === 'tracking').length;

  if (staged === 0 && tracking === 0) return null;

  return (
    <div className={styles.waiting}>
      {staged > 0 ? (
        <button
          type="button"
          className={styles.waitingRow}
          onClick={() => navigate('/app/fixlog')}
        >
          <span className={styles.waitingCount}>{staged}</span>
          <span className={styles.waitingCopy}>
            <span className={styles.waitingLabel}>
              {staged === 1 ? 'Change staged' : 'Changes staged'}
            </span>
            <span className={styles.waitingDesc}>Waiting for you to make it in Loop</span>
          </span>
          <span className={styles.waitingChevron} aria-hidden>→</span>
        </button>
      ) : null}
      {tracking > 0 ? (
        <button
          type="button"
          className={styles.waitingRow}
          onClick={() => navigate('/app/commitlog')}
        >
          <span className={styles.waitingCount}>{tracking}</span>
          <span className={styles.waitingCopy}>
            <span className={styles.waitingLabel}>Tracking outcomes</span>
            <span className={styles.waitingDesc}>Committed changes still being measured</span>
          </span>
          <span className={styles.waitingChevron} aria-hidden>→</span>
        </button>
      ) : null}
    </div>
  );
}
function SectionSkeleton({ label }: { label: string }) {
  return (
    <section className={styles.skeleton} aria-label={label}>
      <span className={styles.skeletonLabel}>{label}</span>
    </section>
  );
}
