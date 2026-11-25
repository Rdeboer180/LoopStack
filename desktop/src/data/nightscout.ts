// Builds a LoopStack Dataset from the person's own Nightscout. The Electron
// main process reads the site (electron/nightscout.cjs) and hands over the
// raw records, trimmed; everything here is pure, so it's tested with fixtures.
//
// Every number is an observation of what Loop and glucose did (SAFE-1): what
// Loop delivered against the scheduled basal, readings in and out of range,
// what changed in the profile. Suggestions come from the phone app's Tuning
// engine in suggestFromNs.ts, under SAFE-5a; nothing else here suggests a setting.
import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import { buildHeadsUps } from '@/lib/alerts/trendHeadsUp';
import type { Dataset, Day, HourState, Pt, SettingsChange } from './dataset';
import { mealResponses } from './meals';
import { summariseDay } from './daily';
import { BANDS, bandRead } from './ranges';
import { computeHypoReport } from '@/lib/metrics/hypoEvents';
import { engineInputs, suggestionsFromNightscout, therapyFrom } from './suggestFromNs';
import { observedAbsorption } from './carbAbsorbed';

// ------------------------------------------------------------ raw records (as main.cjs sends them)

export interface NsEntry { date: number; sgv: number; direction?: string; device?: string }
export interface NsTreatment {
  created_at: string;
  eventType?: string;
  insulin?: number | null;
  carbs?: number | null;
  duration?: number | null;
  rate?: number | null;
  absolute?: number | null;
  automatic?: boolean;
  isSMB?: boolean;
  reason?: string | null;
  notes?: string | null;
  /** Minutes, with a carb entry. */
  absorptionTime?: number | null;
  /** Loop's food type: the emoji or favorite-food name entered with the carbs. */
  foodType?: string | null;
  /** Loop overrides: the insulin-needs factor (1 when absent) and correction range. */
  insulinNeedsScaleFactor?: number | null;
  correctionRange?: number[] | null;
}
export interface NsStatus {
  created_at: string;
  /** Loop's own timestamp for the loop that produced this upload. */
  loopAt?: string | null;
  iob?: number | null;
  cob?: number | null;
  failed?: boolean;
  predicted?: { startDate: string; values: number[] } | null;
  version?: string | null;
  pump?: string | null;
  system?: string | null;
}
export interface NsSchedule { time?: string; timeAsSeconds?: number; value: number }
export interface NsProfile {
  startDate: string;
  basal: NsSchedule[];
  carbratio: NsSchedule[];
  sens: NsSchedule[];
  targetLow: NsSchedule[];
  targetHigh: NsSchedule[];
  units: string;
}
export interface NsRaw {
  /** Host only, for labels: "mysite.example.com". */
  site: string;
  /** The name the person gave in the connect screen. */
  name: string;
  fetchedAt: string;
  entries: NsEntry[];
  treatments: NsTreatment[];
  devicestatus: NsStatus[];
  profiles: NsProfile[];
}

// ------------------------------------------------------------ small helpers

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const MIN = 60_000;
const TOLERANCE = 0.15;
/** Your bands (Settings → Your ranges): the day tracker and heads-ups score against them, as on the phone. */
const LOW = BANDS.low;
const HIGH = BANDS.high;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Local midnight `n` days after `ms`'s midnight; DST-safe. */
const addDays = (ms: number, n: number) => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() + n); return d.getTime(); };
const md = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const dayLabel = (ms: number) => { const d = new Date(ms); return `${WD_SHORT[d.getDay()]} ${d.getDate()}`; };
const hourName = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? 'am' : 'pm'}`;
function rangeLabel(start: number, end: number): string {
  const ap = (h: number) => (h % 24 < 12 ? 'am' : 'pm');
  const n = (h: number) => `${h % 12 || 12}`;
  if (ap(start) === ap(end) && end - start < 12 && end !== 24) return `${n(start)}–${n(end)}${ap(end)}`;
  return `${n(start)}${ap(start)}–${n(end)}${ap(end)}`;
}
function partOfDay(h: number): { one: string; many: string } {
  if (h >= 4 && h < 12) return { one: 'morning', many: 'mornings' };
  if (h >= 12 && h < 17) return { one: 'afternoon', many: 'afternoons' };
  if (h >= 17 && h < 22) return { one: 'evening', many: 'evenings' };
  return { one: 'night', many: 'nights' };
}
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
/** Fill gaps in an hourly series by straight lines (wrapping midnight); all-missing gives zeros. */
function fill(vals: (number | null)[]): number[] {
  const known = vals.map((v, i) => [i, v] as const).filter((x): x is readonly [number, number] => x[1] != null);
  if (!known.length) return vals.map(() => 0);
  return vals.map((v, i) => {
    if (v != null) return v;
    const prev = [...known].reverse().find(([k]) => k < i) ?? known[known.length - 1];
    const next = known.find(([k]) => k > i) ?? known[0];
    const span = ((next[0] - prev[0] + 24) % 24) || 24;
    const t = ((i - prev[0] + 24) % 24) / span;
    return prev[1] + (next[1] - prev[1]) * t;
  });
}
const tms = (t: NsTreatment) => Date.parse(t.created_at);

// ------------------------------------------------------------ schedules and profiles

const secOf = (s: NsSchedule) => s.timeAsSeconds ?? (s.time ? Number(s.time.slice(0, 2)) * 3600 + Number(s.time.slice(3, 5)) * 60 : 0);
export function scheduleAt(sched: readonly NsSchedule[], secondOfDay: number): number {
  const sorted = [...sched].sort((a, b) => secOf(a) - secOf(b));
  let v = sorted[0]?.value ?? 0;
  for (const s of sorted) if (secOf(s) <= secondOfDay) v = s.value;
  return v;
}
/** Mean scheduled rate over one hour, U/h. */
const hourRate = (basal: readonly NsSchedule[], h: number) => {
  let t = 0;
  for (let m = 0; m < 60; m += 5) t += scheduleAt(basal, h * 3600 + m * 60);
  return t / 12;
};
function profileAt(profiles: readonly NsProfile[], ms: number): NsProfile | null {
  let p: NsProfile | null = null;
  for (const x of profiles) if (Date.parse(x.startDate) <= ms) p = x;
  return p ?? profiles[0] ?? null;
}
const mgdl = (p: NsProfile, v: number) => (/mmol/i.test(p.units) ? Math.round(v * 18) : Math.round(v));

// ------------------------------------------------------------ delivery, minute by minute

interface Timeline {
  start: number;
  /** Delivered basal U/h for each minute; NaN where nothing says (scheduled applies). */
  temp: Float64Array;
  /** Automatic bolus units in each hour since start. */
  autoBolusByHour: Map<number, number>;
  userBolusByHour: Map<number, number>;
}
const isAuto = (t: NsTreatment) => Boolean(t.automatic || t.isSMB || t.eventType === 'SMB');
const isBolus = (t: NsTreatment) => typeof t.insulin === 'number' && t.insulin > 0 && /bolus|smb/i.test(t.eventType ?? 'Bolus');

function timeline(treatments: readonly NsTreatment[], start: number, end: number): Timeline {
  const minutes = Math.ceil((end - start) / MIN);
  const temp = new Float64Array(minutes).fill(NaN);
  const evs = treatments
    .filter((t) => /temp basal|suspend pump|resume pump/i.test(t.eventType ?? ''))
    .map((t) => ({ t, at: tms(t) }))
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);
  evs.forEach((e, i) => {
    const kind = (e.t.eventType ?? '').toLowerCase();
    if (kind.includes('resume')) return;
    const next = evs[i + 1]?.at ?? Infinity;
    const rate = kind.includes('suspend') ? 0 : (e.t.absolute ?? e.t.rate ?? NaN);
    // A suspend lasts until the resume (or the next record); a temp basal for its duration.
    const dur = kind.includes('suspend') ? Math.min(next - e.at, 6 * HOUR) : (e.t.duration ?? 0) * MIN;
    const stop = Math.min(e.at + dur, next, end);
    if (!Number.isFinite(rate)) return;
    for (let m = Math.max(0, Math.floor((e.at - start) / MIN)); m < Math.ceil((stop - start) / MIN) && m < minutes; m += 1) temp[m] = rate;
  });
  const autoBolusByHour = new Map<number, number>();
  const userBolusByHour = new Map<number, number>();
  for (const t of treatments) {
    const at = tms(t);
    if (!isBolus(t) || at < start || at >= end) continue;
    const h = Math.floor((at - start) / HOUR);
    const map = isAuto(t) ? autoBolusByHour : userBolusByHour;
    map.set(h, (map.get(h) ?? 0) + (t.insulin ?? 0));
  }
  return { start, temp, autoBolusByHour, userBolusByHour };
}

// ------------------------------------------------------------ the dataset

export interface BuildOptions {
  /** "Now", ms. Defaults to fetchedAt. */
  now?: number;
  /** Days in the review period (default 14). */
  days?: number;
}

export function buildNightscoutDataset(raw: NsRaw, opts: BuildOptions = {}): Dataset {
  const now = opts.now ?? Date.parse(raw.fetchedAt);
  const days = opts.days ?? 14;
  const end = startOfDay(now); // the period ends at last midnight: full days only
  const start = addDays(end, -days);
  const prevStart = addDays(start, -days);

  // Two uploaders (say Loop and a CGM app) can send the same reading; keep one per minute.
  const entries = raw.entries
    .filter((e) => Number.isFinite(e.date) && e.date <= now && Number.isFinite(e.sgv) && e.sgv > 20)
    .sort((a, b) => a.date - b.date)
    .filter((e, i, all) => i === 0 || e.date - all[i - 1].date >= MIN);
  const statuses = raw.devicestatus.filter((d) => Number.isFinite(Date.parse(d.created_at))).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const profiles = [...raw.profiles].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const latestProfile = profiles[profiles.length - 1] ?? null;
  const name = raw.name.trim() || 'Me';
  const first = name.split(/\s+/)[0];

  // Readings indexed by day once: a 180-day period would otherwise rescan every reading for every day.
  const entriesByDay = new Map<number, NsEntry[]>();
  for (const e of entries) { const k = startOfDay(e.date); const a = entriesByDay.get(k); if (a) a.push(e); else entriesByDay.set(k, [e]); }

  // ---------------------------------------------- per day, per hour
  const dayStarts = Array.from({ length: days }, (_, i) => addDays(start, i));
  const DAYS: Day[] = dayStarts.map(dayLabel);
  const tl = timeline(raw.treatments, start, end);
  // Overrides: Loop scales the scheduled basal by the override's insulin needs while it runs,
  // so the schedule Loop works to is the scaled one. Each lasts its duration or until the next.
  const overrideMins = Math.ceil((end - start) / MIN);
  const ovFactor = new Float64Array(overrideMins).fill(1);
  const ovName: (string | null)[] = new Array(overrideMins).fill(null);
  const ovs = raw.treatments.filter((t) => /override/i.test(t.eventType ?? '') && !/cancel/i.test(t.eventType ?? '')).map((t) => ({ t, at: tms(t) })).filter((o) => Number.isFinite(o.at)).sort((a, b) => a.at - b.at);
  ovs.forEach((o, i) => {
    const next = ovs[i + 1]?.at ?? Infinity;
    const dur = (o.t.duration && o.t.duration > 0 ? o.t.duration : 12 * 60) * MIN;
    const stop = Math.min(o.at + Math.min(dur, 24 * HOUR), next, end);
    const f = o.t.insulinNeedsScaleFactor && o.t.insulinNeedsScaleFactor > 0 ? o.t.insulinNeedsScaleFactor : 1;
    const name = (o.t.reason ?? 'Override').trim() || 'Override';
    for (let m = Math.max(0, Math.floor((o.at - start) / MIN)); m < Math.ceil((stop - start) / MIN) && m < overrideMins; m += 1) { ovFactor[m] = f; ovName[m] = name; }
  });
  const SCHED_EFF: Record<Day, number[]> = {};
  const OVERRIDE_HOURS: Record<Day, (string | null)[]> = {};
  const cgmByHour = new Map<number, number>(); // hour index -> readings
  for (const e of entries) if (e.date >= start && e.date < end) cgmByHour.set(Math.floor((e.date - start) / HOUR), (cgmByHour.get(Math.floor((e.date - start) / HOUR)) ?? 0) + 1);
  const loopByHour = new Map<number, number>();
  for (const s of statuses) {
    const at = Date.parse(s.loopAt ?? s.created_at);
    if (at >= start && at < end && !s.failed) loopByHour.set(Math.floor((at - start) / HOUR), (loopByHour.get(Math.floor((at - start) / HOUR)) ?? 0) + 1);
  }

  const STATE: Record<Day, HourState[]> = {};
  const RATE: Record<Day, number[]> = {};
  const AUTO_BOLUS: Record<Day, number[]> = {};
  const schedFor: Record<Day, number[]> = {};
  const usableDay: Record<Day, { ok: boolean; cause: string }> = {};
  dayStarts.forEach((ds, di) => {
    const label = DAYS[di];
    const p = profileAt(profiles, ds + 12 * HOUR);
    const sched = Array.from({ length: 24 }, (_, h) => (p ? hourRate(p.basal, h) : 0));
    schedFor[label] = sched;
    const states: HourState[] = [];
    const rates: number[] = [];
    const autos: number[] = [];
    const effs: number[] = [];
    const ovH: (string | null)[] = [];
    let cgmN = 0;
    let loopHours = 0;
    for (let h = 0; h < 24; h += 1) {
      const hi = Math.floor((ds + h * HOUR - start) / HOUR);
      const cgm = cgmByHour.get(hi) ?? 0;
      const looped = loopByHour.get(hi) ?? 0;
      cgmN += cgm;
      if (looped > 0) loopHours += 1;
      let basal = 0;
      let zeroMin = 0;
      let factor = 0;
      const names = new Map<string, number>();
      for (let m = 0; m < 60; m += 1) {
        const idx = Math.floor((ds + h * HOUR - start) / MIN) + m;
        factor += (ovFactor[idx] ?? 1) / 60;
        const nm = ovName[idx];
        if (nm) names.set(nm, (names.get(nm) ?? 0) + 1);
        const v = tl.temp[idx];
        const rate = Number.isNaN(v) ? sched[h] : v;
        if (rate === 0) zeroMin += 1;
        basal += rate / 60;
      }
      // Temp basals against the schedule; Loop's automatic boluses are counted on their own (AUTO_BOLUS).
      const delivered = basal;
      rates.push(r2(delivered));
      autos.push(r2(tl.autoBolusByHour.get(hi) ?? 0));
      effs.push(r2(sched[h] * factor));
      const topName = [...names].sort((a, b) => b[1] - a[1])[0];
      ovH.push(topName && topName[1] >= 30 ? topName[0] : null);
      if (looped === 0 && cgm < 3) { states.push('x'); continue; }
      const s = sched[h] * factor;
      const d = s > 0 ? (delivered - s) / s : 0;
      states.push(zeroMin >= 30 && delivered <= s * 0.25 ? 's' : d < -TOLERANCE ? 'l' : d > TOLERANCE ? 'm' : 'a');
    }
    STATE[label] = states;
    RATE[label] = rates;
    AUTO_BOLUS[label] = autos;
    SCHED_EFF[label] = effs;
    OVERRIDE_HOURS[label] = ovH;
    const cgmPct = Math.round((cgmN / 288) * 100);
    usableDay[label] = cgmPct < 70
      ? { ok: false, cause: `CGM readings ${cgmPct}% of the day` }
      : loopHours < 18
        ? { ok: false, cause: `Loop uploaded in ${loopHours} of 24 hours` }
        : { ok: true, cause: '' };
  });
  const EXCLUDED = DAYS.filter((d) => !usableDay[d].ok);
  const USABLE = DAYS.filter((d) => usableDay[d].ok);
  const NOT_COUNTED = EXCLUDED[0] ?? null;
  const fullDay = (d: Day) => { const i = DAYS.indexOf(d); return `${WD_SHORT[new Date(dayStarts[i]).getDay()]} ${md(dayStarts[i])}`; };

  const SCHED = Array.from({ length: 24 }, (_, h) => r2(latestProfile ? hourRate(latestProfile.basal, h) : 0));
  const LOOP = Array.from({ length: 24 }, (_, h) => r2(median(USABLE.map((d) => RATE[d][h])) ?? SCHED[h]));
  const countAt = (h: number, st: HourState) => USABLE.filter((d) => STATE[d][h] === st).length;
  const verdict = (h: number): 'a' | 'l' | 'm' | 's' => {
    if (countAt(h, 's') > USABLE.length / 2) return 's';
    const d = SCHED[h] > 0 ? (LOOP[h] - SCHED[h]) / SCHED[h] : 0;
    return Math.abs(d) > TOLERANCE ? (d < 0 ? 'l' : 'm') : 'a';
  };
  /** Runs of neighbouring hours with the same verdict, strongest (most days) first. */
  const stretches = (v: 'l' | 'm') => {
    const out: { a: number; b: number; n: number; pct: number }[] = [];
    for (let h = 0; h < 24; h += 1) {
      if (verdict(h) !== v || (h > 0 && verdict(h - 1) === v)) continue;
      let b = h + 1;
      while (b < 24 && verdict(b) === v) b += 1;
      const n = Math.max(...Array.from({ length: b - h }, (_, i) => countAt(h + i, v)));
      const s = SCHED.slice(h, b).reduce((x, y) => x + y, 0);
      const l = LOOP.slice(h, b).reduce((x, y) => x + y, 0);
      out.push({ a: h, b, n, pct: s > 0 ? Math.round(Math.abs((l - s) / s) * 100) : 0 });
    }
    return out.sort((x, y) => y.n - x.n || y.pct - x.pct);
  };
  const less = stretches('l')[0];
  const more = stretches('m')[0];

  // ---------------------------------------------- glucose at 6am
  const nearest = (ms: number, within = 10 * MIN) => {
    let best: NsEntry | null = null;
    for (const e of entries) if (Math.abs(e.date - ms) <= within && (!best || Math.abs(e.date - ms) < Math.abs(best.date - ms))) best = e;
    return best;
  };
  const HOURLY_G: Record<Day, (number | null)[]> = {};
  dayStarts.forEach((ds, i) => {
    const byH: number[][] = Array.from({ length: 24 }, () => []);
    for (const e of entriesByDay.get(ds) ?? []) byH[new Date(e.date).getHours()].push(e.sgv);
    HOURLY_G[DAYS[i]] = byH.map((v) => { const m = median(v); return m == null ? null : Math.round(m); });
  });
  const G6: Record<Day, { mgdl: number; trend: string } | null> = {};
  dayStarts.forEach((ds, i) => {
    const e = nearest(ds + 6 * HOUR);
    G6[DAYS[i]] = e ? { mgdl: e.sgv, trend: arrow(e.direction).glyph } : null;
  });

  // ---------------------------------------------- exercise days
  const exerciseT = raw.treatments.filter((t) => /exercise/i.test(t.eventType ?? '') || (/override/i.test(t.eventType ?? '') && /run|exercise|workout|activity|walk|ride|gym/i.test(t.reason ?? t.notes ?? '')));
  const RUN_DAYS = DAYS.filter((_, i) => exerciseT.some((t) => tms(t) >= dayStarts[i] && tms(t) < addDays(dayStarts[i], 1)));
  const exHours = exerciseT.filter((t) => tms(t) >= start && tms(t) < end).map((t) => new Date(tms(t)).getHours() + new Date(tms(t)).getMinutes() / 60);
  const exAt = median(exHours);
  const RUN_TIME = exAt == null ? null : { start: exAt, end: exAt + 1, label: `around ${hourName(Math.round(exAt))}` };

  // ---------------------------------------------- now
  const last = entries[entries.length - 1] ?? null;
  const lastStatus = [...statuses].reverse().find((s) => !s.failed) ?? statuses[statuses.length - 1] ?? null;
  const today0 = startOfDay(now);
  const rel = (ms: number) => (ms - today0) / HOUR;
  const points: Pt[] = entries.filter((e) => e.date >= now - 3 * HOUR && e.date <= now).map((e) => [r2(rel(e.date)), e.sgv] as const);
  const pred = lastStatus?.predicted;
  const prediction: Pt[] = pred ? pred.values.slice(0, 19).map((v, i) => [r2(rel(Date.parse(pred.startDate) + i * 5 * MIN)), Math.round(v)] as const) : [];
  const arr = arrow(last?.direction);
  const loopedAt = lastStatus ? Date.parse(lastStatus.loopAt ?? lastStatus.created_at) : NaN;
  const CGM_NOW: Dataset['CGM_NOW'] = {
    mgdl: last ? last.sgv : null,
    trend: arr.glyph,
    trendLabel: arr.label,
    ageMin: last ? Math.max(0, Math.round((now - last.date) / MIN)) : 0,
    statusAt: Number.isFinite(loopedAt) ? new Date(loopedAt).toISOString() : null,
    activeInsulinU: lastStatus?.iob ?? null,
    activeCarbsG: lastStatus?.cob == null ? null : Math.round(lastStatus.cob),
    points,
    prediction,
    day: entries.filter((e) => e.date >= now - 24 * HOUR && e.date <= now).map((e) => [r2(rel(e.date)), e.sgv] as const),
  };

  // ---------------------------------------------- weekday picture: heads-up and day tracker (PROD-2)
  const glucose = entries.map((e) => ({ iso: new Date(e.date).toISOString(), mgdl: e.sgv }));
  const grid = computeDayHourGrid({
    glucose, target: { lowMgdl: LOW, highMgdl: HIGH }, now: new Date(now), weeks: 12, includeSamples: true,
  });
  const todayWd = new Date(now).getDay();
  const hu = buildHeadsUps({ grid }).find((h) => h.weekday === todayWd) ?? null;
  const HEADS_UP: Dataset['HEADS_UP'] = hu ? {
    when: `today ${hourName(hu.fireOn.hour)}`,
    title: hu.title,
    detail: `${hu.sharePct}% of readings · last ${hu.weeks} ${WD_LONG[hu.weekday]}s`,
    kind: hu.kind,
    weekday: hu.weekday,
    stretch: [hu.startHour, hu.endHour + 1],
  } : null;

  // 0–6: Sunday to Saturday. 7: every day. 8: weekdays (Mon–Fri). 9: weekends. All within the review period.
  // Index Loop status by day once (readings are indexed above): ten groups over up to 180 days would otherwise rescan everything.
  const statusesByDay = new Map<number, NsStatus[]>();
  for (const st of statuses) { const at = Date.parse(st.created_at); const k = startOfDay(at); const a = statusesByDay.get(k); if (a) a.push(st); else statusesByDay.set(k, [st]); }
  const DAY_BY_WEEKDAY = Array.from({ length: 10 }, (_, wd) => dayTracker(wd));
  function dayTracker(wd: number): Dataset['DAY'] | null {
    const every = wd >= 7;
    const inGroup = (d: number) => { const w = new Date(d).getDay(); return wd === 7 || (wd === 8 ? w >= 1 && w <= 5 : wd === 9 ? w === 0 || w === 6 : w === wd); };
    const dates = dayStarts.filter(inGroup);
    const g: number[][] = Array.from({ length: 24 }, () => []);
    const iob: number[][] = Array.from({ length: 24 }, () => []);
    const cob: number[][] = Array.from({ length: 24 }, () => []);
    const ex = new Map<number, number>();
    let weeks = 0;
    for (const d0 of dates) {
      const d1 = addDays(d0, 1);
      const day = entriesByDay.get(d0) ?? [];
      if (day.length < 144) continue; // half a day of CGM, or it doesn't vote
      weeks += 1;
      const byH: number[][] = Array.from({ length: 24 }, () => []);
      for (const e of day) byH[new Date(e.date).getHours()].push(e.sgv);
      byH.forEach((v, h) => { const m = median(v); if (m != null) g[h].push(m); });
      const ib: number[][] = Array.from({ length: 24 }, () => []);
      const cb: number[][] = Array.from({ length: 24 }, () => []);
      for (const s of statusesByDay.get(d0) ?? []) {
        const at = Date.parse(s.created_at);
        const h = new Date(at).getHours();
        if (typeof s.iob === 'number') ib[h].push(s.iob);
        if (typeof s.cob === 'number') cb[h].push(s.cob);
      }
      ib.forEach((v, h) => { const m = median(v); if (m != null) iob[h].push(m); });
      cb.forEach((v, h) => { const m = median(v); if (m != null) cob[h].push(m); });
      for (const t of exerciseT) {
        const at = tms(t);
        if (at < d0 || at >= d1) continue;
        let left = t.duration ?? 30;
        let cur = at;
        while (left > 0) {
          const h = new Date(cur).getHours();
          const room = 60 - new Date(cur).getMinutes();
          const take = Math.min(room, left);
          ex.set(h, (ex.get(h) ?? 0) + take);
          left -= take;
          cur += take * MIN;
        }
      }
    }
    // "weeks" counts the days that voted; for a group of weekdays, that's days, reported as weeks.
    if (weeks < (wd === 7 ? 7 : every ? 4 : 2)) return null;
    const exercise: Record<number, number> = {};
    for (const [h, m] of ex) exercise[h] = Math.round(m / weeks);
    return {
      weekday: wd,
      name: wd === 7 ? 'day' : wd === 8 ? 'weekday' : wd === 9 ? 'weekend day' : WD_LONG[wd],
      glucose: fill(g.map((v) => { const m = median(v); return m == null ? null : Math.round(m); })).map(Math.round),
      iob: fill(iob.map((v) => median(v))).map(r2),
      cob: fill(cob.map((v) => median(v))).map((v) => Math.round(v)),
      exercise,
      weeks: every ? Math.max(1, Math.round(weeks / 7)) : weeks,
      ...(every ? { days: weeks } : {}),
      stretch: !every && HEADS_UP && HEADS_UP.weekday === wd ? HEADS_UP.stretch : null,
    };
  }
  const trackedWd = HEADS_UP?.weekday ?? todayWd;
  const DAY: Dataset['DAY'] = DAY_BY_WEEKDAY[trackedWd] ?? DAY_BY_WEEKDAY.find(Boolean) ?? {
    weekday: trackedWd, name: WD_LONG[trackedWd], glucose: Array(24).fill(0), iob: Array(24).fill(0), cob: Array(24).fill(0), exercise: {}, weeks: 0, stretch: null,
  };
  const AVG_DAY: Pt[] = [...DAY.glucose.map((g, h) => [h, g] as const), [24, DAY.glucose[0]] as const];

  // ---------------------------------------------- the 14-day read (AGP order)
  const inWindow = entries.filter((e) => e.date >= start && e.date < end).map((e) => e.sgv);
  const READ = readOf(inWindow, days);
  const prevValues = entries.filter((e) => e.date >= prevStart && e.date < start).map((e) => e.sgv);
  const prevRead = readOf(prevValues, days);
  const slots = new Set<number>();
  for (const s of statuses) {
    const at = Date.parse(s.loopAt ?? s.created_at);
    if (at >= start && at < end && !s.failed) slots.add(Math.floor((at - start) / (5 * MIN)));
  }
  const totalSlots = days * 288;
  const gaps: { at: number; len: number }[] = [];
  let run = 0;
  for (let i = 0; i <= totalSlots; i += 1) {
    if (i < totalSlots && !slots.has(i)) { run += 1; continue; }
    if (run * 5 >= 60) gaps.push({ at: start + (i - run) * 5 * MIN, len: run * 5 });
    run = 0;
  }
  gaps.sort((a, b) => b.len - a.len);
  const fullRead: Dataset['READ'] = {
    ...READ,
    mine: bandRead(inWindow),
    prev: prevRead.sensorWornPct >= 50 ? { inRangePct: bandRead(prevValues).inRangePct, meanMgdl: prevRead.meanMgdl, gmiPct: prevRead.gmiPct, cvPct: prevRead.cvPct } : null,
    inRangeSinceLastVisit: prevRead.sensorWornPct >= 50 && READ.sensorWornPct >= 50 ? Math.round(READ.inRangePct - prevRead.inRangePct) : null,
    automationPct: Math.round((slots.size / totalSlots) * 100),
    automationGaps: gaps.length ? gaps.slice(0, 2).map((g) => `${g.len >= 120 ? `${Math.round(g.len / 60)} h` : `${g.len} min`} on ${md(g.at)}`).join(', ') : 'none over an hour',
  };

  const AGP = agpOf(entries.filter((e) => e.date >= start && e.date < end));

  // ---------------------------------------------- insulin, in consensus terms (DATA-2)
  const dailyTotals: number[] = [];
  let algo = 0;
  let user = 0;
  for (const d of USABLE) {
    const di = DAYS.indexOf(d);
    let basal = 0;
    let manual = 0;
    let auto = 0;
    for (let h = 0; h < 24; h += 1) {
      const hi = di * 24 + h;
      manual += tl.userBolusByHour.get(hi) ?? 0;
      auto += tl.autoBolusByHour.get(hi) ?? 0;
      basal += RATE[d][h];
    }
    dailyTotals.push(basal + auto + manual);
    algo += basal + auto;
    user += manual;
  }
  const overrides = raw.treatments.filter((t) => /override/i.test(t.eventType ?? '') && tms(t) >= start && tms(t) < end);
  // An override lasts its duration, or until the next one starts (Loop uploads a new record when one is replaced), at most a day.
  const byTime = [...overrides].sort((x, y) => tms(x) - tms(y));
  const overrideMin = byTime.reduce((m, t, i) => {
    const next = byTime[i + 1] ? (tms(byTime[i + 1]) - tms(t)) / MIN : Infinity;
    return m + Math.max(0, Math.min(t.duration ?? 0, next, 24 * 60));
  }, 0);
  const presetCounts = new Map<string, number>();
  for (const t of overrides) { const k = (t.reason ?? t.notes ?? 'Override').trim() || 'Override'; presetCounts.set(k, (presetCounts.get(k) ?? 0) + 1); }
  const INSULIN: Dataset['INSULIN'] = {
    totalDailyU: r1(median(dailyTotals) ?? 0),
    algorithmPct: algo + user > 0 ? Math.round((algo / (algo + user)) * 100) : 0,
    userPct: algo + user > 0 ? 100 - Math.round((algo / (algo + user)) * 100) : 0,
    overrideHoursPerWeek: r1(overrideMin / 60 / (days / 7)),
    presets: presetCounts.size ? [...presetCounts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} (${n} use${n === 1 ? '' : 's'})`).join(', ') : 'none',
  };

  // ---------------------------------------------- settings changes, from the profile history (VIS-B3)
  const CHANGES = profileChanges(profiles, first, addDays(now, -120));

  // ---------------------------------------------- lunch, before and after
  const lastChange = CHANGES.find((c) => c.status === 'applied');
  const changeAt = lastChange ? Date.parse((lastChange as SettingsChange & { at?: string }).at ?? '') : NaN;
  const useChange = Number.isFinite(changeAt) && changeAt > addDays(now, -days * 2);
  const [bFrom, bTo, aFrom, aTo] = useChange
    ? [addDays(changeAt, -days), startOfDay(changeAt), addDays(changeAt, 1), Math.min(addDays(changeAt, days + 1), end)]
    : [prevStart, start, start, end];
  const side = (from: number, to: number) => {
    // Each reading's clock time is worked out once, then dropped into every half-hour slot it is within 15 minutes of.
    const slots = new Map<number, number[]>();
    let usable = 0;
    for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
      const dayEs = (entriesByDay.get(d) ?? []).filter((e) => e.date >= from && e.date < to);
      if (dayEs.length >= 0.7 * 288) usable += 1;
      for (const e of dayEs) {
        const dt = new Date(e.date);
        const h = dt.getHours() + dt.getMinutes() / 60;
        for (const t of new Set([Math.floor(h * 2) / 2, Math.ceil(h * 2) / 2])) {
          if (t < 6 || t > 22 || Math.abs(h - t) > 0.25) continue;
          const a = slots.get(t); if (a) a.push(e.sgv); else slots.set(t, [e.sgv]);
        }
      }
    }
    const pts: Pt[] = [];
    for (let t = 6; t <= 22; t += 0.5) {
      const m = median(slots.get(t) ?? []);
      if (m != null) pts.push([t, Math.round(m)]);
    }
    return { pts, usable, days: Math.round((to - from) / DAY_MS) };
  };
  const before = side(bFrom, bTo);
  const after = side(aFrom, aTo);
  const LUNCH: Dataset['LUNCH'] = {
    change: lastChange && useChange ? `${lastChange.setting} ${lastChange.from} → ${lastChange.to} on ${lastChange.date}` : `The ${days} days before, against the last ${days} days`,
    source: lastChange && useChange ? `from your Nightscout profile history` : 'no settings change between the two',
    reviewDate: 'Not set',
    scope: [11, 15],
    before: before.pts.length ? before.pts : [[6, 0], [22, 0]],
    after: after.pts.length ? after.pts : [[6, 0], [22, 0]],
    usable: { before: before.usable, after: after.usable, days: Math.max(before.days, after.days) },
    beforeLabel: useChange ? 'Before the change' : `${md(bFrom)} – ${md(bTo - 1)}`,
    afterLabel: useChange ? 'After the change' : `${md(aFrom)} – ${md(aTo - 1)}`,
  };
  const peakIn = (pts: readonly Pt[]) => pts.filter((p) => p[0] >= 11 && p[0] <= 15).reduce<Pt | null>((b, p) => (!b || p[1] > b[1] ? p : b), null);
  const pb = peakIn(LUNCH.before);
  const pa = peakIn(LUNCH.after);

  // ---------------------------------------------- devices
  const newest = <K extends keyof NsStatus>(k: K) => [...statuses].reverse().find((s) => s[k])?.[k] ?? null;
  const setup = [newest('version') ?? newest('system') ?? 'Loop', newest('pump'), cgmName(entries)].filter(Boolean).join(' · ');
  const lastOf = (re: RegExp) => raw.treatments.filter((t) => re.test(t.eventType ?? '') && tms(t) <= now).map(tms).sort((a, b) => b - a)[0];
  const site = lastOf(/site change|pod change|cannula change/i);
  const sensor = lastOf(/sensor start|sensor change/i);
  const age = (ms: number) => { const h = Math.floor((now - ms) / HOUR); return `${Math.floor(h / 24)}d ${h % 24}h`; };

  // ---------------------------------------------- meal response (the period's carb entries, at least 30 days)
  // Observed absorption per entry, the way Loop counts it (insulin counteraction), so it lines up with Loop's carb screen.
  // Only the meal window (plus a day of lead-in for insulin still acting) goes through the engine.
  const mealsFrom = addDays(now, -Math.max(30, days));
  let absorbed: ReturnType<typeof observedAbsorption> | undefined;
  try {
    const lead = addDays(mealsFrom, -1);
    const eng = engineInputs(entries.filter((e) => e.date >= lead), raw.treatments.filter((t) => tms(t) >= lead), statuses.filter((st) => Date.parse(st.created_at) >= lead));
    absorbed = observedAbsorption({ glucose: eng.glucose, carbs: eng.carbs, insulin: eng.insulin, therapy: therapyFrom(latestProfile, now), end: now, loopCob: eng.loopCob });
  } catch { /* no observed absorption: the ledger shows it as unknown */ }
  const MEALS = mealResponses({
    absorbed,
    carbs: raw.treatments.filter((t) => typeof t.carbs === 'number' && t.carbs > 0).map((t) => ({ at: tms(t), grams: t.carbs!, absorptionMin: t.absorptionTime ?? null, name: t.foodType ?? null })),
    boluses: raw.treatments.filter((t) => isBolus(t) && !isAuto(t)).map((t) => ({ at: tms(t), units: t.insulin! })),
    glucose: entries.map((e) => ({ at: e.date, mgdl: e.sgv })),
    iob: statuses.filter((s) => typeof s.iob === 'number').map((s) => ({ at: Date.parse(s.created_at), u: s.iob! })),
  }, mealsFrom, now);

  // ---------------------------------------------- daily glucose (each day of the period, and today so far)
  const longDay = (ms: number) => { const d = new Date(ms); return `${WD_SHORT[d.getDay()]}, ${md(ms)}`; };
  const DAILY: Dataset['DAILY'] = {
    days: dayStarts.map((ds, i) => summariseDay(DAYS[i], longDay(ds), (entriesByDay.get(ds) ?? []).map((e) => e.sgv), usableDay[DAYS[i]].ok)),
    today: (() => {
      const t = summariseDay(dayLabel(end), `Today, ${md(end)}`, entries.filter((e) => e.date >= end && e.date <= now).map((e) => e.sgv), true);
      return t.meanMgdl == null ? null : t;
    })(),
  };

  // ---------------------------------------------- suggestions (SAFE-5a): the Tuning engine and the meal ledger
  let SUGGESTIONS: Dataset['SUGGESTIONS'] = [];
  try {
    SUGGESTIONS = suggestionsFromNightscout({ entries, treatments: raw.treatments, statuses, profile: latestProfile, now });
  } catch { /* the engine never breaks the dashboard */ }

  const mine = bandRead(inWindow);
  const tir = mine.inRangePct;
  const below = r1(mine.urgentPct + mine.lowPct);
  const lunchDelta = pb && pa ? pb[1] - pa[1] : null;
  const lead = useChange ? 'After the change' : `In the last ${days} days`;

  return {
    source: 'nightscout',
    sourceLabel: raw.site,
    SUGGESTIONS,
    fetchedAt: raw.fetchedAt,
    today: md(now),
    DAYS,
    PERIOD: { label: `${md(start)} – ${md(end - 1)}`, days, tolerance: TOLERANCE },
    EXCLUDED,
    NOT_COUNTED,
    NOT_COUNTED_CAUSE: NOT_COUNTED ? usableDay[NOT_COUNTED].cause : '',
    RUN_DAYS,
    RUN_TIME,
    SCHED,
    LOOP,
    STATE,
    RATE,
    AUTO_BOLUS,
    SCHED_EFF,
    OVERRIDE_HOURS,
    G6,
    HOURLY_G,
    PATIENT: {
      name,
      first,
      initials: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      setup: setup || 'Loop',
      loopedMinAgo: Number.isFinite(loopedAt) ? Math.max(0, Math.round((now - loopedAt) / MIN)) : 999,
      podAge: site ? `Site ${age(site)}` : 'Site age not recorded',
      sensorDay: sensor ? `Sensor day ${Math.floor((now - sensor) / DAY_MS) + 1}` : 'Sensor age not recorded',
      buildExpiresDays: null,
      age: null,
      engagement: 'Reviews what you share',
      clinician: 'your care team',
      nextVisit: 'not set',
    },
    THERAPY: { ...therapyFrom(latestProfile, now), from: latestProfile ? 'nightscout' : 'sample' },
    LOWS: computeHypoReport({ glucose: entries.map((e) => ({ iso: new Date(e.date).toISOString(), mgdl: e.sgv })), target: { lowMgdl: BANDS.low, highMgdl: BANDS.high, urgentLowMgdl: BANDS.urgentLow }, now: new Date(now), windowDays: days }),
    CGM_NOW,
    HEADS_UP,
    WEEKDAY_GRID: grid,
    AVG_DAY,
    CARE_NOTE: null,
    LUNCH,
    READ: fullRead,
    AGP,
    INSULIN,
    DAY,
    CHANGES,
    QUESTION: null,
    PATIENTS: [{ id: 'me', name, initials: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), system: setup || 'Loop', visit: 'not set', packet: { shared: 'not yet' }, lastPacket: null, flags: CHANGES.length ? ['Settings changed'] : [] }],
    DAY_BY_WEEKDAY,
    MEALS,
    DAILY,
    TEXT: {
      headsUpBody: HEADS_UP ? `${WD_LONG[HEADS_UP.weekday]} ${rangeLabel(HEADS_UP.stretch[0], HEADS_UP.stretch[1])}: ${hu!.sharePct}% of readings ${HEADS_UP.kind === 'low' ? `below ${LOW}` : `above ${HIGH}`} mg/dL over the last ${hu!.weeks} ${WD_LONG[HEADS_UP.weekday]}s.` : '',
      dayTrackerFinding: dayFinding(DAY),
      dayTrackerLoop: '',
      loopFinding: [
        less ? `Most ${partOfDay(less.a).many} ${rangeLabel(less.a, less.b)}, algorithm-modulated basal ran below the scheduled rate.` : 'Algorithm-modulated basal ran close to the scheduled rate through the day.',
        more ? `${rangeLabel(more.a, more.b)} it ran above.` : '',
      ].filter(Boolean).join(' '),
      lunchFinding: pb && pa ? `${lead}, median lunch peaks were ${Math.abs(lunchDelta!) < 5 ? `within ${Math.max(1, Math.abs(lunchDelta!))} mg/dL of before` : `about ${Math.abs(lunchDelta!)} mg/dL ${lunchDelta! > 0 ? 'lower' : 'higher'}`} (${pb[1]} → ${pa[1]} mg/dL).` : 'Not enough lunchtime readings on both sides to compare.',
      pattern: HEADS_UP
        ? `${WD_LONG[HEADS_UP.weekday]}s ${rangeLabel(HEADS_UP.stretch[0], HEADS_UP.stretch[1])} run ${HEADS_UP.kind} in ${hu!.sharePct}% of readings, over ${hu!.weeks} weeks.`
        : `${tir}% in range over ${days} days, ${below}% below ${LOW} mg/dL. No weekday stretch passed the 10% heads-up bar today.`,
      suspendNote: '',
      loopGlance: less
        ? `${partOfDay(less.a).one[0].toUpperCase()}${partOfDay(less.a).one.slice(1)} ${rangeLabel(less.a, less.b)}: Loop delivered about ${less.pct}% less than scheduled.`
        : more ? `${rangeLabel(more.a, more.b)}: Loop delivered about ${more.pct}% more than scheduled.` : 'Loop delivered about as scheduled through the day.',
      eveningNote: more && more.a >= 17 ? `${rangeLabel(more.a, more.b)}, Loop delivered about ${more.pct}% more than scheduled on ${more.n} of ${USABLE.length} evenings.` : '',
      lunchContext: useChange ? 'The change day is left out of both sides.' : 'No settings change recorded between the two periods. What happened, not what caused it.',
      excludedNote: EXCLUDED.length === 0 ? '' : EXCLUDED.length === 1 ? `${fullDay(EXCLUDED[0])} isn’t counted` : `${EXCLUDED.length} days aren’t counted`,
    },
  };
}

// ------------------------------------------------------------ pieces

const ARROWS: Record<string, { glyph: string; label: string }> = {
  DoubleUp: { glyph: '⇈', label: 'rising quickly' },
  SingleUp: { glyph: '↑', label: 'rising' },
  FortyFiveUp: { glyph: '↗', label: 'rising slowly' },
  Flat: { glyph: '→', label: 'steady' },
  FortyFiveDown: { glyph: '↘', label: 'falling slowly' },
  SingleDown: { glyph: '↓', label: 'falling' },
  DoubleDown: { glyph: '⇊', label: 'falling quickly' },
};
export const arrow = (dir?: string) => ARROWS[dir ?? ''] ?? { glyph: '·', label: 'no trend' };

function cgmName(entries: readonly NsEntry[]): string | null {
  const d = [...entries].reverse().find((e) => e.device && !/^loop:|^openaps:|^trio:|^unknown$/i.test(e.device))?.device;
  if (!d) return null;
  if (/g7/i.test(d)) return 'Dexcom G7';
  if (/g6/i.test(d)) return 'Dexcom G6';
  if (/libre/i.test(d)) return 'Libre';
  return d.split(/[\s:]/)[0];
}

function readOf(values: readonly number[], days: number) {
  const n = values.length;
  const pct = (f: (v: number) => boolean) => (n ? r1((values.filter(f).length / n) * 100) : 0);
  const veryLowPct = pct((v) => v < 54);
  const lowPct = pct((v) => v >= 54 && v < 70);
  const highPct = pct((v) => v > 180 && v <= 250);
  const veryHighPct = pct((v) => v > 250);
  const inRangePct = n ? r1(100 - veryLowPct - lowPct - highPct - veryHighPct) : 0;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  return {
    sensorWornPct: Math.min(100, Math.round((n / (days * 288)) * 100)),
    veryLowPct, lowPct, inRangePct, highPct, veryHighPct,
    gmiPct: n ? r1(3.31 + 0.02392 * mean) : 0,
    cvPct: mean ? Math.round((sd / mean) * 100) : 0,
    meanMgdl: Math.round(mean),
  };
}

function agpOf(es: readonly NsEntry[]): Dataset['AGP'] {
  const hours = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
  const at = (h: number) => {
    const v = es.filter((e) => { const d = new Date(e.date); const x = d.getHours() + d.getMinutes() / 60; const dist = Math.min(Math.abs(x - h), 24 - Math.abs(x - h)); return dist <= 1; }).map((e) => e.sgv).sort((a, b) => a - b);
    return v;
  };
  const cols = hours.map(at);
  const q = (p: number) => cols.map((v) => (v.length ? Math.round(quantile(v, p)) : 0));
  return { hours, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
}

function dayFinding(d: Dataset['DAY']): string {
  if (!d.weeks) return 'Not enough weeks of readings for a day tracker yet.';
  const lo = d.glucose.reduce((b, g, h) => (g < d.glucose[b] ? h : b), 0);
  const hi = d.glucose.reduce((b, g, h) => (g > d.glucose[b] ? h : b), 0);
  const ip = d.iob.reduce((b, g, h) => (g > d.iob[b] ? h : b), 0);
  return `On the average ${d.name}, glucose is lowest at ${hourName(lo)}, ${d.glucose[lo]} mg/dL, and highest at ${hourName(hi)}, ${d.glucose[hi]} mg/dL. Active insulin peaks at about ${d.iob[ip].toFixed(1)} U around ${hourName(ip)}.`;
}

/** Profile-to-profile differences, newest first. Each is a change the person made in Loop. */
function profileChanges(profiles: readonly NsProfile[], first: string, since: number): (SettingsChange & { at: string })[] {
  const out: (SettingsChange & { at: string })[] = [];
  const show = (p: NsProfile, s: readonly NsSchedule[], kind: 'ratio' | 'rate' | 'mgdl') => {
    const vals = [...s].sort((a, b) => secOf(a) - secOf(b));
    const f = (v: number) => (kind === 'ratio' ? `1:${v}` : kind === 'rate' ? `${v} U/h` : `${mgdl(p, v)}`);
    if (vals.length === 1) return f(vals[0].value);
    if (kind === 'rate') return `${r2(Array.from({ length: 24 }, (_, h) => hourRate(vals, h)).reduce((a, b) => a + b, 0))} U a day`;
    return vals.map((v) => `${f(v.value)} from ${hourName(Math.floor(secOf(v) / 3600))}`).join(', ');
  };
  const same = (a: readonly NsSchedule[], b: readonly NsSchedule[]) => JSON.stringify([...a].map((x) => [secOf(x), x.value]).sort()) === JSON.stringify([...b].map((x) => [secOf(x), x.value]).sort());
  for (let i = 1; i < profiles.length; i += 1) {
    const a = profiles[i - 1];
    const b = profiles[i];
    const at = Date.parse(b.startDate);
    if (at < since) continue;
    const fields: [string, keyof NsProfile, 'ratio' | 'rate' | 'mgdl'][] = [
      ['Carb ratio', 'carbratio', 'ratio'],
      ['Insulin sensitivity', 'sens', 'mgdl'],
      ['Basal schedule', 'basal', 'rate'],
      ['Correction range, low', 'targetLow', 'mgdl'],
      ['Correction range, high', 'targetHigh', 'mgdl'],
    ];
    for (const [setting, key, kind] of fields) {
      const sa = a[key] as NsSchedule[];
      const sb = b[key] as NsSchedule[];
      if (same(sa, sb)) continue;
      out.push({
        id: `${String(key)}-${at}`,
        at: b.startDate,
        date: md(at),
        setting,
        from: show(a, sa, kind),
        to: show(b, sb, kind),
        proposedBy: first,
        agreedBy: null,
        appliedBy: `${first}, in Loop`,
        reviewDate: null,
        status: 'applied',
        note: 'From your Nightscout profile history.',
      });
    }
  }
  return out.reverse();
}
