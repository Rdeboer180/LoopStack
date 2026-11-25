// Glance on the Mac: the shared component (src/components/Glance/GlanceView.tsx,
// the same one the phone home uses) fed from the desktop's dataset. This file
// only maps data and wires the Mac's reads: switching data set shows skeletons,
// Read again dims under a progress line, a failed read keeps the last numbers.
import { useState, useSyncExternalStore } from 'react';
import { GlanceView, type GlanceKey, type GlanceState, type GlanceViewModel } from '@/components/Glance/GlanceView';
import { DATA } from '../data/current';
import { expandFrom } from './expand';
import { lowTrendNote, weekNote } from '@/components/Glance/glanceNotes';
import { buildGlance, type GlanceModel } from '../data/glance';
import { BANDS } from '../data/ranges';
import { loadNightscout, onPeriodLoading, onReading, periodLoading, readingNow } from '../data/source';
import type { Go } from '../nav';
import type { TileKind } from '../layout/model';

/** What each tile opens: the detail that explains its number. */
const OPENS: Record<GlanceKey, { tile: TileKind; label: string }> = {
  g: { tile: 'glucose-now', label: 'Glucose now' },
  t: { tile: 'time-in-range', label: 'Time in range' },
  a: { tile: 'key-numbers', label: 'Key numbers' },
  i: { tile: 'what-loop-did', label: 'What Loop did' },
  w: { tile: 'daily-glucose', label: 'Daily glucose' },
  l: { tile: 'time-in-range', label: 'Lows as events, in Time in range' },
  d: { tile: 'device-life', label: 'Device life' },
};
const OPEN_LABELS = Object.fromEntries(Object.entries(OPENS).map(([k, v]) => [k, v.label])) as Record<GlanceKey, string>;

/** The Mac's model in the shared shape. Insulin reads Loop-adjusted and you-started (DATA-1/2). */
export function toView(g: GlanceModel): GlanceViewModel {
  const n = g.now;
  return {
    periodLabel: g.periodLabel,
    headline: g.headline,
    headsUp: g.headsUp,
    band: { low: BANDS.low, high: BANDS.high },
    now: {
      mgdl: n.mgdl, arrow: n.arrow, trendLabel: n.trendLabel, status: n.status, tone: n.tone, stale: n.stale, ageMin: n.ageMin, ageText: n.ageText,
      foot: `${n.iobU == null ? '—' : `${n.iobU.toFixed(2)} U`} active insulin · ${n.cobG == null ? '—' : `${Math.round(n.cobG)} g`} active carbs`,
      points: n.points, prediction: n.prediction,
    },
    tir: { ...g.tir, pct: g.avg.mgdl == null ? null : g.tir.pct },
    avg: g.avg,
    insulin: {
      cells: [
        { value: g.insulin.totalU, digits: 1, unit: ' U', label: 'total' },
        { value: g.insulin.loopPct, unit: '%', label: 'Loop‑adjusted' },
        { value: g.insulin.youPct, unit: '%', label: 'you started' },
      ],
      foot: g.insulin.autoPct == null ? 'Time in automation not known' : `Loop ran itself ${g.insulin.autoPct}% of the time`,
    },
    week: g.week,
    weekNote: weekNote(g.week),
    // Percent of readings, not a count of events: 258 events over 180 days says less than 3.4% of the time.
    lows: {
      value: g.below.pct,
      digits: 1,
      unit: '%',
      caption: `of readings under ${g.below.under} · ${g.below.urgentPct}% under ${g.below.urgentUnder}`,
      trend: g.below.trend,
      trendNote: lowTrendNote(g.below.trend),
    },
    side: { title: 'Devices', icon: 'device', rows: g.devices },
  };
}

export function Glance({ go }: { go: Go }) {
  const reading = useSyncExternalStore(onReading, readingNow);
  const periodBusy = useSyncExternalStore(onPeriodLoading, periodLoading) != null;
  const [failed, setFailed] = useState<string | null>(null);
  const live = DATA.source === 'nightscout';
  const state: GlanceState = reading === 'switch' ? 'loading' : reading === 'refresh' || periodBusy ? 'refreshing' : 'ready';

  const again = async () => {
    setFailed(null);
    try { await loadNightscout(); } catch (e) { setFailed(e instanceof Error ? e.message : String(e)); }
  };
  const fetched = DATA.fetchedAt ? new Date(DATA.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <GlanceView
      model={toView(buildGlance(DATA))}
      state={state}
      loadingText="Reading your Nightscout: glucose, treatments and profile…"
      sourceLine={live ? `From your Nightscout${fetched ? `, read ${fetched}` : ''}` : 'Sample data, made-up numbers'}
      error={failed}
      errorTitle="Couldn’t read your Nightscout."
      onRetry={again}
      onRefresh={live ? again : undefined}
      opens={OPEN_LABELS}
      onOpen={(k) => expandFrom(document.querySelector(`.gl-tile.gl-${k}`), `.gl-tile.gl-${k}`, () => go({ tile: OPENS[k].tile }))}
    />
  );
}
