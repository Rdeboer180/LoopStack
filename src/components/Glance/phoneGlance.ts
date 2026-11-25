// The phone's Glance model: the shared GlanceView fed from the phone's data
// (current glucose, recent readings, the range's metrics, Loop mode, the
// week's rhythm and Apple Health activity). Same tiles as the Mac, with two
// honest differences: the phone has no pod or sensor ages, so the last tile is
// Activity; and it can't tell Loop's insulin from insulin you started, so the
// insulin tile reads total, time in automation and carbs. No basal/bolus ratio
// (DATA-1/2). Observations only (SAFE-1).
import type { GlucoseMetrics } from '@/data/types';
import type { CurrentGlucose } from '@/lib/glucoseStatus';
import { classifyGlucose, classifyTrend, trendArrow, trendLabel } from '@/lib/glucoseStatus';
import type { GlucoseReading } from '@/data/sources/types';
import type { DayRhythm } from '@/lib/metrics/timeTrends';
import type { GlanceViewModel } from './GlanceView';
import { weekNote } from './glanceNotes';

/** A reading older than this greys out and says how old (DM-1). */
export const STALE_MIN = 15;
const r1 = (v: number) => Math.round(v * 10) / 10;
const dotFor = (pct: number) => (pct >= 70 ? 'var(--range-in)' : pct >= 50 ? 'var(--range-high)' : 'var(--range-low)');

export interface PhoneGlanceInput {
  current: CurrentGlucose | null;
  /** The source says the stream went quiet. */
  sourceStale?: boolean;
  recent: readonly GlucoseReading[];
  metrics: GlucoseMetrics | null;
  /** Share of the window with closed loop confirmed running, 0–100. */
  closedLoopPct: number | null;
  rhythm: readonly DayRhythm[] | null;
  periodLabel: string;
  headsUp?: string | null;
  now: Date;
}

export function buildPhoneGlance(x: PhoneGlanceInput): GlanceViewModel | null {
  const m = x.metrics;
  if (!m && !x.current) return null;
  const c = x.current;
  const ageMin = c ? Math.max(0, Math.round((x.now.getTime() - Date.parse(c.lastUpdatedIso)) / 60000)) : 0;
  const stale = !!c && (x.sourceStale === true || ageMin > STALE_MIN);
  const status = c ? classifyGlucose(c) : null;
  const trend = c ? classifyTrend(c.ratePer5min) : null;
  const urgent = m?.urgentLowMgdl ?? 54;
  const word = !c ? 'No reading yet'
    : stale ? `Last reading ${ageMin} min ago, not live`
    : c.mgdl < urgent ? `Urgent low · ${trendLabel[trend!].toLowerCase()}`
    : `${status === 'low' ? 'Low' : status === 'urgent_high' ? 'High' : status === 'high_falling' ? 'High, coming down' : 'In range'} · ${trendLabel[trend!].toLowerCase()}`;
  const tone: GlanceViewModel['now']['tone'] = !c ? 'in' : stale ? 'stale' : status === 'low' ? 'low' : status === 'urgent_high' || status === 'high_falling' ? 'high' : 'in';
  // The last 3 hours as [hour of day, mg/dL], hours running on past midnight so the line never folds back.
  const since = x.now.getTime() - 3 * 3600_000;
  const base = new Date(x.now); base.setHours(0, 0, 0, 0);
  const points = x.recent
    .map((r) => [Date.parse(r.iso), r.mgdl] as const)
    .filter(([t, g]) => Number.isFinite(t) && t >= since && g > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([t, g]) => [(t - base.getTime()) / 3600_000, g] as const);
  const has = !!m && m.avgGlucose > 0;
  const lowPct = m ? r1(m.tir.veryLow + m.tir.low) : null;
  const delta = m && m.hasPriorWindow ? Math.round(m.deltas.inRange.value) : null;
  const days = (x.rhythm ?? []).filter((d) => !d.isFuture);
  return {
    periodLabel: x.periodLabel,
    headline: has ? `${Math.round(m!.tir.inRange)}% in range, average ${Math.round(m!.avgGlucose)}` : 'Your numbers are on their way',
    headsUp: x.headsUp ?? null,
    band: { low: m?.targetLowMgdl ?? 70, high: m?.targetHighMgdl ?? 180 },
    now: {
      mgdl: c ? Math.round(c.mgdl) : null,
      arrow: c && !stale ? trendArrow[trend!] : '',
      trendLabel: trend ? trendLabel[trend] : '',
      status: word,
      tone,
      stale,
      ageMin,
      ageText: !c ? 'No reading' : ageMin <= 1 ? 'just now' : `${ageMin} min ago`,
      foot: m ? `${r1(m.totalInsulin)} U insulin and ${Math.round(m.carbs)} g carbs a day` : 'Insulin and carbs appear once the period is read',
      points,
      prediction: [],
    },
    tir: {
      pct: has ? m!.tir.inRange : null,
      urgent: m?.tir.veryLow ?? 0, low: m?.tir.low ?? 0, high: m?.tir.high ?? 0, veryHigh: m?.tir.veryHigh ?? 0,
      range: m ? `${m.targetLowMgdl}–${m.targetHighMgdl}` : '',
      delta,
    },
    avg: { mgdl: has ? Math.round(m!.avgGlucose) : null, gmi: has ? m!.gmi : null, cv: has ? Math.round(m!.cv) : null },
    insulin: {
      cells: [
        { value: m ? r1(m.totalInsulin) : null, digits: 1, unit: ' U', label: 'total' },
        { value: x.closedLoopPct == null ? null : Math.round(x.closedLoopPct), unit: '%', label: 'in automation' },
        { value: m ? Math.round(m.carbs) : null, unit: ' g', label: 'carbs' },
      ],
      foot: 'A day, on average over the period',
    },
    week: days.slice(-8).map((d) => ({ label: d.isToday ? 'Today' : d.label, pct: d.tirPct, today: d.isToday, dot: d.tirPct == null ? 'transparent' : dotFor(d.tirPct) })),
    weekNote: weekNote(days.slice(-8).map((d) => ({ name: new Date(d.dateIso).toLocaleDateString([], { weekday: 'short' }), pct: d.tirPct, today: d.isToday }))),
    lows: {
      value: lowPct,
      digits: 1,
      unit: '%',
      caption: m ? `of readings under ${m.targetLowMgdl} · ${r1(m.tir.veryLow)}% under ${urgent}` : 'Not enough readings',
    },
    side: {
      title: 'Activity',
      icon: 'activity',
      rows: m
        ? [
            { label: 'Exercise', value: `${Math.round(m.exerciseMinutes)} min a day`, frac: Math.min(1, m.exerciseMinutes / 30) },
            { label: 'Steps', value: `${Math.round(m.steps).toLocaleString()} a day`, frac: Math.min(1, m.steps / 8000) },
          ]
        : [],
    },
  };
}
