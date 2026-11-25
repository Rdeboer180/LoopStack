// Glance: the dashboard's top component, the period's TLDR in seven tiles
// (the board's consensus design, Nov 23). Every number comes from the dataset
// the rest of the dashboard reads, scored against your bands (ranges.ts), so the
// Glance never disagrees with a tile under it. Observations only (SAFE-1); no
// basal/bolus ratio, insulin reads as Loop-adjusted and you-started (DATA-1/2).
import type { Dataset, DailyGlucose, Pt } from './dataset';
import { BANDS, rangeText, type Bands } from './ranges';
import { nowStatus } from './glucoseNow';
import { ringStroke } from '../ui/DayRings';
import { stretches } from '@/components/Glance/glanceNotes';

/** A reading older than this greys out and says how old (DM-1). */
export const STALE_MIN = 15;

export interface GlanceDay { label: string; name: string; pct: number | null; today: boolean; dot: string }
export interface GlanceDevice { label: string; value: string; frac: number | null }

export interface GlanceModel {
  periodLabel: string;
  headline: string;
  headsUp: string | null;
  now: {
    mgdl: number | null;
    arrow: string;
    trendLabel: string;
    status: string;
    tone: 'low' | 'high' | 'in' | 'stale';
    stale: boolean;
    ageMin: number;
    ageText: string;
    iobU: number | null;
    cobG: number | null;
    points: readonly Pt[];
    prediction: readonly Pt[];
  };
  tir: { pct: number; urgent: number; low: number; high: number; veryHigh: number; range: string; delta: number | null };
  avg: { mgdl: number | null; gmi: number | null; cv: number | null };
  insulin: { totalU: number | null; loopPct: number | null; youPct: number | null; autoPct: number | null };
  week: GlanceDay[];
  lows: { count: number; lowest: number | null; wentUrgent: boolean; overnight: number; under: number };
  /** Time below your low as a percent of readings, the urgent part, and the share in each stretch of the period. */
  below: { pct: number | null; urgentPct: number; under: number; urgentUnder: number; trend: (number | null)[] };
  devices: GlanceDevice[];
}

const finite = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

/** "Fri, Nov 6" → "F"; today → "Today". */
function dayLetter(d: DailyGlucose, today: boolean): string {
  return today ? 'Today' : (d.label.split(',')[0] ?? d.day).slice(0, 1);
}

export function buildGlance(D: Dataset, b: Bands = BANDS): GlanceModel {
  const m = D.READ.mine;
  const has = Number.isFinite(D.READ.meanMgdl) && D.READ.meanMgdl > 0;
  const c = D.CGM_NOW;
  const stale = c.mgdl != null && c.ageMin > STALE_MIN;
  const st = stale ? null : nowStatus(c.mgdl, c.points, b);
  const lastDays = D.DAILY.days.slice(-7);
  const week: GlanceDay[] = [...lastDays, ...(D.DAILY.today ? [D.DAILY.today] : [])].map((d, i, all) => {
    const today = D.DAILY.today != null && i === all.length - 1;
    const pct = d.inRangePct != null && (d.usable || today) ? Math.round(d.inRangePct) : null;
    return { label: dayLetter(d, today), name: today ? 'today' : (d.label.split(',')[0] ?? d.day), pct, today, dot: pct == null ? 'transparent' : ringStroke(pct) };
  });
  const L = D.LOWS;
  const synthetic = D.source === 'synthetic';
  const devices: GlanceDevice[] = synthetic
    // The sample's pod is 2d 14h into 3 days, its sensor on day 7 of 10: the bar is how far through each one is.
    ? [{ label: 'Pod', value: '2d 14h of 3d', frac: (2 * 24 + 14) / 72 }, { label: 'Sensor', value: 'day 7 of 10', frac: 0.7 }]
    : [{ label: 'Site', value: D.PATIENT.podAge.replace(/^Site /, ''), frac: null }, { label: 'Sensor', value: D.PATIENT.sensorDay.replace(/^Sensor /, ''), frac: null }];
  const ins = D.INSULIN;
  return {
    periodLabel: `${D.PERIOD.days}d`,
    headline: has ? `${Math.round(m.inRangePct)}% in range, average ${Math.round(D.READ.meanMgdl)}` : 'No readings in this period yet',
    headsUp: D.HEADS_UP ? `${D.HEADS_UP.title}` : null,
    now: {
      mgdl: finite(c.mgdl),
      arrow: stale ? '' : c.trend,
      trendLabel: c.trendLabel,
      status: c.mgdl == null ? 'No reading yet' : stale ? `Last reading ${c.ageMin} min ago, not live` : st ? `${st.word} · ${st.trend.toLowerCase()}` : 'Reading',
      tone: stale ? 'stale' : st?.tone ?? 'in',
      stale,
      ageMin: c.ageMin,
      ageText: c.mgdl == null ? 'No reading' : c.ageMin <= 1 ? 'just now' : `${c.ageMin} min ago`,
      iobU: finite(c.activeInsulinU),
      cobG: finite(c.activeCarbsG),
      points: c.points,
      prediction: c.prediction,
    },
    tir: { pct: has ? m.inRangePct : 0, urgent: m.urgentPct, low: m.lowPct, high: m.highPct, veryHigh: m.veryHighPct, range: rangeText(b), delta: D.READ.inRangeSinceLastVisit },
    avg: { mgdl: has ? Math.round(D.READ.meanMgdl) : null, gmi: has ? finite(D.READ.gmiPct) : null, cv: has ? finite(D.READ.cvPct) : null },
    insulin: {
      totalU: finite(ins.totalDailyU) && ins.totalDailyU > 0 ? ins.totalDailyU : null,
      loopPct: finite(ins.algorithmPct),
      youPct: finite(ins.userPct),
      autoPct: finite(D.READ.automationPct),
    },
    week,
    below: { pct: has ? Math.round((m.urgentPct + m.lowPct) * 10) / 10 : null, urgentPct: m.urgentPct, under: b.low, urgentUnder: b.urgentLow, trend: stretches(D.DAILY.days.map((d) => (d.usable ? d.belowPct : null)), 12) },
    lows: { count: L.low.all.count, lowest: L.low.all.lowestMgdl, wentUrgent: L.urgentLow.all.count > 0, overnight: L.low.overnight.count, under: L.low.thresholdMgdl },
    devices,
  };
}
