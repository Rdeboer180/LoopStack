/**
 * SYNTHETIC DATA. "Sam R." is a made-up patient for the LoopStack desktop
 * portfolio build. None of these numbers come from a real person, pump, pod,
 * CGM or Loop install (the care-team side uses synthetic patients only).
 *
 * Ported from the design-board generators (gen_hourly.py and gen_glass.py) so
 * the app and the boards agree number for number: 14 days, Oct 30 – Nov 12,
 * 13 usable. Loop 3.6 · Omnipod DASH · Dexcom G7.
 */

import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import type { Suggestion } from './suggestions';
import { observedAbsorption } from './carbAbsorbed';
import { realLoopTherapy } from '@/data/loopTherapy';
import type { Dataset, Day, HourState, ListedPatient, Pt, SettingsChange } from './dataset';
import { mealResponses, type MealInputs } from './meals';
import { summariseDay } from './daily';
import { BANDS, bandRead } from './ranges';
import { computeHypoReport } from '@/lib/metrics/hypoEvents';

export const DAYS = [
  'Fri 30', 'Sat 31', 'Sun 1', 'Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6',
  'Sat 7', 'Sun 8', 'Mon 9', 'Tue 10', 'Wed 11', 'Thu 12',
] as const;

export const PERIOD = { label: 'Oct 30 – Nov 12', days: 14, tolerance: 0.15 } as const;

/** The one day not counted, and why (VIS-4: missing is drawn as missing, cause named). */
export const NOT_COUNTED: Day = 'Sun 8';
export const NOT_COUNTED_CAUSE = 'Pod connection lost 12–6am';

/** Lunchtime run, 12:15–1:15pm. */
export const RUN_DAYS: readonly Day[] = ['Fri 30', 'Fri 6'];
export const RUN_TIME = { start: 12.25, end: 13.25, label: '12:15–1:15pm' } as const;

/** Scheduled basal for each hour, U/h. */
export const SCHED: readonly number[] = [
  ...Array(3).fill(0.8), ...Array(3).fill(0.95), ...Array(3).fill(0.92), ...Array(3).fill(0.9),
  ...Array(3).fill(0.75), ...Array(3).fill(0.75), ...Array(3).fill(0.85), ...Array(3).fill(0.85),
];

/** What Loop delivered, median U/h for each hour over the 13 usable days. */
export const LOOP: readonly number[] = [
  0.78, 0.81, 0.79, 0.96, 0.94, 0.97, 0.55, 0.57, 0.86, 0.89, 0.88, 0.91,
  0.76, 0.77, 0.74, 0.74, 0.73, 0.75, 0.88, 1.06, 1.05, 0.86, 0.85, 0.84,
];

function buildState(): Record<Day, HourState[]> {
  const state = Object.fromEntries(DAYS.map((d) => [d, Array<HourState>(24).fill('a')])) as Record<Day, HourState[]>;
  const about6: Day[] = ['Wed 4', 'Sat 7'];
  const about7: Day[] = ['Wed 4', 'Sat 7', 'Sun 1'];
  for (const d of DAYS) {
    if (d === NOT_COUNTED) continue;
    if (!about6.includes(d)) state[d][6] = 'l';
    if (!about7.includes(d)) state[d][7] = 'l';
  }
  for (const d of ['Mon 2', 'Thu 12'] as Day[]) state[d][8] = 'l';
  state['Tue 3'][10] = 'l';
  state['Wed 11'][13] = 'm';
  for (const d of RUN_DAYS) {
    state[d][15] = 's';
    state[d][16] = 's';
    state[d][17] = d === 'Fri 6' ? 's' : 'l';
  }
  const more7: Day[] = ['Sat 31', 'Mon 2', 'Tue 3', 'Thu 5', 'Sat 7', 'Tue 10', 'Wed 11'];
  const more8: Day[] = [...more7, 'Sun 1'];
  for (const d of more7) state[d][19] = 'm';
  for (const d of more8) state[d][20] = 'm';
  for (const d of ['Mon 2', 'Sat 7'] as Day[]) state[d][18] = 'm';
  for (let h = 0; h < 6; h += 1) state[NOT_COUNTED][h] = 'x';
  // The not-counted day is still drawn after the gap (faded).
  state[NOT_COUNTED][6] = 'l';
  state[NOT_COUNTED][7] = 'l';
  return state;
}

/** STATE[day][hour]: what Loop did that hour against the schedule. */
export const STATE: Readonly<Record<Day, readonly HourState[]>> = buildState();

/** Glucose at 6am, mg/dL, with its CGM trend arrow. Sun 8 is not counted. */
export const G6: Readonly<Record<Day, { mgdl: number; trend: '↘' | '→' | '↗' } | null>> = {
  'Fri 30': { mgdl: 92, trend: '↘' }, 'Sat 31': { mgdl: 101, trend: '→' }, 'Sun 1': { mgdl: 98, trend: '→' },
  'Mon 2': { mgdl: 88, trend: '↘' }, 'Tue 3': { mgdl: 96, trend: '→' }, 'Wed 4': { mgdl: 131, trend: '↗' },
  'Thu 5': { mgdl: 94, trend: '↘' }, 'Fri 6': { mgdl: 99, trend: '→' }, 'Sat 7': { mgdl: 127, trend: '→' },
  'Sun 8': null, 'Mon 9': { mgdl: 90, trend: '↘' }, 'Tue 10': { mgdl: 97, trend: '→' },
  'Wed 11': { mgdl: 85, trend: '↘' }, 'Thu 12': { mgdl: 93, trend: '→' },
};

export const PATIENT = {
  name: 'Sam R.',
  initials: 'SR',
  setup: 'Loop 3.6 · Omnipod DASH · Dexcom G7',
  loopedMinAgo: 2,
  podAge: 'Pod 2d 14h',
  sensorDay: 'Sensor day 7 of 10',
  buildExpiresDays: 62,
  age: 34,
  engagement: 'Advise on safety settings',
  clinician: 'Dr. Okafor',
  nextVisit: 'Thu, Nov 19',
} as const;


export const CGM_NOW = {
  mgdl: 112,
  trend: '↘',
  trendLabel: 'falling slowly',
  ageMin: 2,
  activeInsulinU: 1.35,
  activeCarbsG: 22,
  points: [[6.0, 128], [6.5, 134], [7.0, 141], [7.5, 150], [8.0, 146], [8.5, 131], [9.0, 118], [9.25, 112]] as Pt[],
  prediction: [[9.25, 112], [9.75, 108], [10.25, 107], [10.75, 109]] as Pt[],
  day: sampleDay(),
} as const;

/**
 * The sample's last 24 hours of 5-minute readings, for the 3/6/12/24h view: yesterday evening's
 * dinner rise, a dip under 65 around 2:30am, a dawn climb, then this morning's readings above.
 * Deterministic, so the demo and the tests always draw the same day.
 */
function sampleDay(): Pt[] {
  const morning: Pt[] = [[6.0, 128], [6.5, 134], [7.0, 141], [7.5, 150], [8.0, 146], [8.5, 131], [9.0, 118], [9.25, 112]];
  const bump = (h: number, at: number, height: number, width: number) => height * Math.exp(-(((h - at) / width) ** 2));
  const out: Pt[] = [];
  for (let i = 0; i <= 24 * 12; i++) {
    const h = Math.round((9.25 - 24 + i / 12) * 100) / 100;
    let v: number;
    if (h >= 6) {
      const k = morning.findIndex((p) => p[0] >= h);
      const [a, b] = k <= 0 ? [morning[0], morning[0]] : [morning[k - 1], morning[k]];
      v = b[0] === a[0] ? a[1] : a[1] + ((h - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    } else {
      v = 118 + bump(h, -4.8, 92, 1.1) + bump(h, -8.5, 38, 0.9) - bump(h, 2.5, 56, 0.8) + bump(h, 5, 14, 1.2);
      v += Math.sin(i * 1.7) * 3 + Math.sin(i * 0.37) * 4;
    }
    out.push([h, Math.round(v)]);
  }
  return out;
}

export const HEADS_UP = {
  when: 'today 1:00pm',
  title: 'Friday 3–6pm often runs low',
  detail: '48% of readings · last 4 Fridays',
} as const;

/** Median glucose on an average Friday, last 4 weeks. 3–6pm is the stretch the heads-up names. */
export const AVG_FRIDAY: readonly Pt[] = [
  [0, 132], [2, 124], [4, 118], [6, 126], [8, 158], [10, 138], [12, 162], [13, 150], [14, 112],
  [15, 86], [16, 68], [17, 72], [18, 104], [20, 156], [22, 142], [24, 134],
];

export const CARE_NOTE = {
  from: 'Dr. Okafor',
  date: 'Nov 12',
  text: 'Thanks, Sam. I’ll look at your Fridays before Thursday’s visit.',
} as const;

/** Lunch before and after the carb ratio change. Median glucose, 14 days each side, 13 usable. */
export const LUNCH = {
  change: 'Carb ratio 1:10 → 1:9 on Oct 2',
  source: 'you proposed, Dr. Okafor agreed',
  reviewDate: 'Thu, Nov 19',
  scope: [12, 16] as const,
  before: [[6, 128], [8, 150], [10, 138], [11, 132], [12, 150], [12.75, 190], [13.5, 212], [14.25, 198], [15, 172], [16, 150], [18, 140], [20, 158], [22, 144]] as Pt[],
  after: [[6, 126], [8, 146], [10, 136], [11, 128], [12, 144], [12.75, 176], [13.5, 192], [14.25, 176], [15, 154], [16, 140], [18, 138], [20, 154], [22, 140]] as Pt[],
  usable: { before: 13, after: 13, days: 14 },
} as const;

// ------------------------------------------------------------ the 14-day read (AGP order)

/**
 * The standard glucose read for Oct 30 – Nov 12, in the order clinicians
 * review it (VIS-10): enough data, then lows, then time in range, then the
 * curve. Percentages of CGM readings; the five bands add to 100.
 */
export const READ = {
  sensorWornPct: 96,
  veryLowPct: 0.4,
  lowPct: 1.7,
  inRangePct: 74,
  highPct: 19.9,
  veryHighPct: 4.0,
  inRangeSinceLastVisit: 3,
  /** The 14 days before, made up like the rest. */
  prev: { inRangePct: 70.2, meanMgdl: 153, gmiPct: 6.9, cvPct: 36 },
  automationPct: 94,
  automationGaps: 'lost pod connection 6 h, CGM warm-up 2 h',
  gmiPct: 6.8,
  cvPct: 34,
  meanMgdl: 148,
  /** Against your own bands, from the same made-up readings the daily rings draw. */
  get mine() { return bandRead(samPool()); },
};

/** AGP percentile curves, mg/dL every 2 hours, from the boards (Concept 07). */
export const AGP = {
  hours: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
  p5: [92, 88, 86, 90, 104, 96, 100, 98, 62, 84, 108, 100, 92],
  p25: [118, 112, 108, 114, 128, 118, 126, 132, 98, 116, 136, 126, 118],
  p50: [138, 130, 124, 132, 150, 138, 150, 160, 128, 140, 162, 150, 138],
  p75: [160, 152, 146, 156, 178, 162, 182, 196, 158, 168, 196, 178, 160],
  p95: [205, 196, 190, 200, 228, 210, 236, 252, 214, 222, 256, 230, 205],
} as const;

/**
 * Insulin over the 13 usable days, in the consensus terms clinicians use
 * (DATA-2): algorithm-modulated (Loop's automatic adjustments and automatic
 * boluses) against user-initiated (meal and manual boluses).
 */
export const INSULIN = {
  totalDailyU: 38.6,
  algorithmPct: 56,
  userPct: 44,
  overrideHoursPerWeek: 3.5,
  presets: 'Running (2 uses, both Fridays)',
} as const;

/** The average Friday, hour by hour, for the day tracker (from the boards, gen07ab.py). */
export const FRIDAY = {
  glucose: [132, 128, 124, 120, 118, 122, 138, 152, 148, 136, 128, 124, 150, 168, 132, 78, 66, 69, 96, 142, 156, 148, 140, 136],
  iob: [0.29, 0.19, 0.09, 0.09, 0, 0.09, 0.56, 1.32, 1.51, 0.93, 0.47, 0.37, 2.43, 3.0, 1.88, 0.75, 0.09, -0.19, 0.56, 2.25, 2.07, 1.12, 0.56, 0.37],
  cob: [0, 0, 0, 0, 0, 0, 0, 35, 24, 9, 0, 0, 52, 33, 13, 2, 15, 9, 4, 60, 37, 15, 4, 0],
  /** Exercise minutes in each hour. 1pm is the lunchtime run. */
  exercise: { 7: 6, 12: 5, 13: 40, 18: 12 } as Readonly<Record<number, number>>,
  weeks: 4,
  stretch: [15, 18] as const,
} as const;

/** Every settings change in this window and the one before it, with its source (VIS-B3). */
export const CHANGES: readonly SettingsChange[] = [
  {
    id: 'q-friday',
    date: 'Nov 11',
    setting: 'Friday afternoons',
    from: 'No preset',
    to: 'Exercise preset, or a different Friday afternoon basal',
    proposedBy: 'Sam',
    agreedBy: null,
    appliedBy: null,
    reviewDate: 'Thu, Nov 19',
    status: 'proposed',
    note: 'Sam’s question, waiting on the care team.',
  },
  {
    id: 'cr-lunch',
    date: 'Oct 2',
    setting: 'Carb ratio, lunch',
    from: '1:10',
    to: '1:9',
    proposedBy: 'Sam',
    agreedBy: 'Dr. Okafor',
    appliedBy: 'Sam, in Loop',
    reviewDate: 'Thu, Nov 19',
    status: 'applied',
    note: '14 days before and after, 13 usable each side.',
  },
  {
    id: 'premeal',
    date: 'Sep 4',
    setting: 'Pre-Meal preset range',
    from: '90–100 mg/dL',
    to: '80–90 mg/dL',
    proposedBy: 'J. Patel, CDCES',
    agreedBy: 'Sam',
    appliedBy: 'Sam, in Loop',
    reviewDate: 'Oct 2',
    status: 'reviewed',
    note: 'Reviewed at the Oct 2 visit. Kept.',
  },
];

/** Sam's open question, with the two options it names. */
export const QUESTION = {
  date: 'Nov 11',
  text: 'Use an exercise preset on Fridays, or lower Friday afternoon basal?',
  options: [
    { id: 'A', label: 'Exercise preset, Fridays', how: 'Loop Presets · Sam turns it on' },
    { id: 'B', label: 'Lower Friday afternoon basal', how: 'Basal schedule · Sam edits it' },
  ],
  attached: 'Friday 3–6pm heads-up · day tracker',
} as const;

/** The light patient list on the care-team side. Only Sam carries a packet. */
export const PATIENTS: readonly ListedPatient[] = [
  { id: 'sam', name: 'Sam R.', initials: 'SR', system: 'Loop 3.6 · Omnipod DASH · Dexcom G7', visit: 'Thu, Nov 19', packet: { shared: 'Nov 12' }, lastPacket: null, flags: ['Question waiting', 'Settings changed'] },
  { id: 'maya', name: 'Maya T.', initials: 'MT', system: 'Trio 0.2 · Omnipod DASH · Dexcom G7', visit: 'Thu, Nov 19', packet: null, lastPacket: 'Oct 14, expired', flags: [] },
  { id: 'devon', name: 'Devon A.', initials: 'DA', system: 'Loop 3.4 · Omnipod Eros · Dexcom G6', visit: 'Fri, Nov 20', packet: null, lastPacket: null, flags: [] },
  { id: 'priya', name: 'Priya N.', initials: 'PN', system: 'iAPS 4.0 · Medtrum · Libre 3', visit: 'Mon, Nov 23', packet: null, lastPacket: 'Sep 30, expired', flags: [] },
];

// ------------------------------------------------------------ meals (synthetic)

/** Made-up meals for Sam, Oct 14 – Nov 12: repeat favorites with their own shapes, so the tile has something to group. Some burrito bowls dip low late and pizza runs high, so the outcomes vary. */
function samMeals(): MealInputs {
  const MIN = 60_000;
  const kinds = [
    { name: '🥣 Oatmeal + berries', hour: 7.5, g: 45, abs: 180, rise: 70, peak: 55, back: 150, u: 4.5 },
    { name: '🌯 Burrito bowl', hour: 12.25, g: 70, abs: 240, rise: 95, peak: 80, back: 260, u: 7, dip: 54 },
    { name: '🍕 Pizza (2 slices)', hour: 18.75, g: 75, abs: 300, rise: 85, peak: 140, back: 330, u: 7.5 },
    { name: '🥗 Chicken salad', hour: 12.5, g: 25, abs: 120, rise: 30, peak: 45, back: 90, u: 2.5 },
  ];
  const carbs: MealInputs['carbs'] = [];
  const boluses: MealInputs['boluses'] = [];
  const glucose: MealInputs['glucose'] = [];
  const iob: MealInputs['iob'] = [];
  const day0 = new Date(2026, 9, 14).getTime();
  const meals: { at: number; k: (typeof kinds)[number]; j: number }[] = [];
  for (let d = 0; d < 30; d += 1) {
    const base = new Date(day0); base.setDate(base.getDate() + d);
    kinds.forEach((k, ki) => {
      if ((d + ki) % 3 === 2 || (ki === 2 && d % 7 !== 4)) return; // pizza on Fridays only
      if (ki === 3 && d % 2 === 0) return;
      if (ki === 1 && d % 2 === 1) return;
      meals.push({ at: base.getTime() + k.hour * 60 * MIN, k, j: (d * 7 + ki * 3) % 5 });
    });
  }
  for (const m of meals) {
    carbs.push({ at: m.at, grams: m.k.g, absorptionMin: m.k.abs, name: m.k.name });
    boluses.push({ at: m.at, units: m.k.u });
  }
  for (let t = day0; t < day0 + 30 * 24 * 60 * MIN; t += 5 * MIN) {
    let g = 112;
    let ins = 0.3;
    for (const m of meals) {
      const x = (t - m.at) / MIN;
      if (x < 0 || x > 420) continue;
      const rise = m.k.rise + (m.j - 2) * 6;
      const k = m.k.peak + (m.j - 2) * 5;
      g += x <= k ? rise * Math.sin((x / k) * (Math.PI / 2)) : rise * Math.max(0, 1 - (x - k) / (m.k.back + (m.j - 2) * 10 - k)) ** 1.4;
      // Some burrito bowls run low late, after the rise has come back down.
      const dip = 'dip' in m.k ? m.k.dip : 0;
      if (dip && m.j === 0 && x > m.k.back - 30 && x < m.k.back + 90) g -= dip * Math.sin(((x - (m.k.back - 30)) / 120) * Math.PI);
      ins += x < 240 ? m.k.u * Math.max(0, 1 - x / 240) : 0;
    }
    glucose.push({ at: t, mgdl: Math.round(g) });
    iob.push({ at: t, u: Math.round(ins * 100) / 100 });
  }
  return { carbs, boluses, glucose, iob };
}

// ------------------------------------------------------------ hourly glucose per day (synthetic)

/** Made-up hourly medians for each day: a shared day shape, 6am from G6, Friday afternoons low after the run. */
function samHourly(): Record<Day, (number | null)[]> {
  const shape = [132, 128, 122, 116, 110, 104, 96, 101, 118, 134, 128, 124, 142, 165, 150, 118, 98, 104, 138, 176, 182, 164, 148, 138];
  const out: Record<Day, (number | null)[]> = {};
  DAYS.forEach((d, i) => {
    out[d] = shape.map((g, h) => {
      if (d === NOT_COUNTED && h < 6) return null;
      if (h === 6 && G6[d]) return G6[d]!.mgdl;
      if (RUN_DAYS.includes(d) && h >= 15 && h < 18) return [72, 66, 70][h - 15];
      const wobble = Math.round(Math.sin((i + 1) * (h + 2) * 0.7) * 9);
      const evening = h >= 19 && h < 21 && STATE[d][h] === 'a' ? -24 : 0;
      return g + wobble + evening;
    });
  });
  return out;
}

// ------------------------------------------------------------ every day (synthetic)

/** The average day across the fortnight: glucose from the AGP median, insulin and carbs around three meals. Made up. */
function samEveryDay(): Dataset['DAY'] {
  const at = (h: number) => {
    const i = Math.floor(h / 2);
    const t = (h % 2) / 2;
    return Math.round(AGP.p50[i] + (AGP.p50[i + 1] - AGP.p50[i]) * t);
  };
  const meal = (h: number, at0: number, size: number, len: number) => (h >= at0 && h < at0 + len ? size * (1 - (h - at0) / len) : 0);
  return {
    weekday: 7,
    name: 'day',
    glucose: Array.from({ length: 24 }, (_, h) => at(h)),
    iob: Array.from({ length: 24 }, (_, h) => Math.round((0.3 + meal(h, 7, 2.2, 4) + meal(h, 12, 2.6, 4) + meal(h, 18, 2.4, 4)) * 100) / 100),
    cob: Array.from({ length: 24 }, (_, h) => Math.round(meal(h, 7, 30, 3) + meal(h, 12, 45, 3) + meal(h, 18, 50, 4))),
    exercise: { 7: 4, 13: 6, 18: 5 },
    weeks: 2,
    stretch: null,
  };
}

// ------------------------------------------------------------ daily glucose (synthetic)

/** Made-up readings for each day: a daily curve around a day's own average, so the tile has spread to draw. */
const SAM_MEANS: Record<string, number> = {
  'Fri 30': 141, 'Sat 31': 152, 'Sun 1': 160, 'Mon 2': 146, 'Tue 3': 139, 'Wed 4': 158, 'Thu 5': 144,
  'Fri 6': 138, 'Sat 7': 163, 'Mon 9': 147, 'Tue 10': 150, 'Wed 11': 142, 'Thu 12': 145,
};
// A day's made-up readings: a daily curve around its own average, with an early-morning dip so the low bands have something in them.
const samReadings = (mean: number, seed: number, n = 288) => Array.from({ length: n }, (_, k) => {
  const h = (k / 288) * 24;
  const meal = Math.max(0, Math.sin(((h - 12.5) / 3) * Math.PI)) * 55 + Math.max(0, Math.sin(((h - 19) / 3) * Math.PI)) * 45;
  const dip = Math.max(0, Math.sin(((h - 3) / 2) * Math.PI)) * (seed % 3 === 0 ? 70 : 40);
  const wave = Math.sin((k + seed * 7) / 9) * 9;
  return Math.round(mean - 22 + meal - dip + wave);
});
let pool: number[] | null = null;
const samPool = () => (pool ??= DAYS.flatMap((d, i) => (d === NOT_COUNTED ? [] : samReadings(SAM_MEANS[d], i))));

function samDaily(): Dataset['DAILY'] {
  const means = SAM_MEANS;
  const months = ['Oct', 'Oct', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov', 'Nov'];
  const readings = samReadings;
  return {
    days: DAYS.map((d, i) => (d === NOT_COUNTED
      ? summariseDay(d, `${d.split(' ')[0]}, ${months[i]} ${d.split(' ')[1]}`, [], false)
      : summariseDay(d, `${d.split(' ')[0]}, ${months[i]} ${d.split(' ')[1]}`, readings(means[d], i), true))),
    today: summariseDay('Fri 13', 'Today, Nov 13', readings(128, 20, 111), true),
  };
}

/** Four sample weeks for exploring the Friday heads-up. Use the same evidence
 * calculation as Nightscout and retain the Sunday sensor gap in this fixture. */
function sampleWeekdayGrid() {
  const now = new Date(2026, 10, 13);
  const glucose = [];
  for (let day = 0; day < 28; day++) {
    const date = new Date(2026, 9, 16 + day);
    if (date.getMonth() === 10 && date.getDate() === 8) continue;
    for (let hour = 0; hour < 24; hour++) {
      for (let i = 0; i < 12; i++) {
        const iso = new Date(2026, 9, 16 + day, hour, i * 5).toISOString();
        const friday = date.getDay() === 5 && hour >= 15 && hour < 18;
        const lowCount = hour === 15 ? 7 : hour === 16 ? 6 : 4 + Number(day === 21);
        const mgdl = friday ? (i < lowCount ? 62 + i : 77 + i) :
          Math.round(130 + 28 * Math.sin((hour - 8) / 3) + 7 * Math.cos(i + day));
        glucose.push({ iso, mgdl });
      }
    }
  }
  return computeDayHourGrid({ glucose, now, target: { lowMgdl: BANDS.low, highMgdl: BANDS.high }, weeks: 12, includeSamples: true });
}

// ------------------------------------------------------------ the dataset

const SAM_MEALS = (() => {
  const raw = samMeals();
  const end = new Date(2026, 10, 13).getTime();
  // The sample patient's observed absorption, counted the way Loop does (carbAbsorbed.ts), against the phone app's sample therapy.
  const absorbed = observedAbsorption({
    glucose: raw.glucose.map((g) => ({ iso: new Date(g.at).toISOString(), mgdl: g.mgdl })),
    carbs: raw.carbs.map((c) => ({ iso: new Date(c.at).toISOString(), grams: c.grams, absorptionHours: (c.absorptionMin ?? 180) / 60, label: c.name ?? undefined })),
    insulin: raw.boluses.map((b) => ({ iso: new Date(b.at).toISOString(), units: b.units, kind: 'bolus' as const })),
    therapy: realLoopTherapy,
    end,
  });
  return mealResponses({ ...raw, absorbed }, new Date(2026, 9, 14).getTime(), end);
})();

/** A fixed sample, written by hand so the demo shows every grade (the synthetic glucose doesn't respond to insulin). */
function samSuggestions(): Suggestion[] {
  const base = { kind: 'setting' as const, note: 'Read from the hours of the day with enough clean readings, across 21 days. Each figure is damped to 20% of the computed correction: a nudge per pass, over weeks.' };
  return [
    { ...base, id: 'basal-07', target: 'basal', label: 'Basal rate, 7–8am', unit: 'U/h', current: 0.92, reading: 0.85, confidence: 'good', evidence: '214 five-minute steps over 19 days', scope: 7 },
    { ...base, id: 'basal-15', target: 'basal', label: 'Basal rate, 3–4pm', unit: 'U/h', current: 0.8, reading: 0.75, confidence: 'good', evidence: '188 five-minute steps over 19 days', scope: 15 },
    { ...base, id: 'basal-19', target: 'basal', label: 'Basal rate, 7–8pm', unit: 'U/h', current: 0.85, reading: 0.9, confidence: 'limited', evidence: '61 five-minute steps over 12 days', scope: 19 },
    { ...base, id: 'carbRatio', target: 'carbRatio', label: 'Carb ratio', unit: 'g per U', current: 9, reading: 9.5, confidence: 'limited', evidence: '41 meals over 19 days', note: 'Carbs logged on 17 of 21 days. The reading is caveated until 60 meals or more show the same.' },
    { ...base, id: 'isf', target: 'isf', label: 'Insulin sensitivity', unit: 'mg/dL per U', current: 45, reading: 48, confidence: 'good', evidence: '19 days of readings', note: 'Read from correction-only stretches: no carbs on board, no exercise.' },
    { id: 'food-burrito-bowl', kind: 'food', target: 'absorption', label: 'Burrito bowl', unit: 'min', current: 180, reading: 210, confidence: 'good', evidence: '11 meals · done-time 214 min (to 90% absorbed)', note: 'Usually entered at 3h, but the observed done-time tracks a 3.5h absorption more closely across 11 meals.', scope: 'Burrito bowl', grams: 85 },
    { id: 'food-pad-thai', kind: 'food', target: 'absorption', label: 'Pad thai', unit: 'min', current: 180, reading: 240, confidence: 'limited', evidence: '6 meals · done-time 251 min (to 90% absorbed)', note: 'Usually entered at 3h, but the observed done-time tracks your 4h preset more closely across 6 meals.', scope: 'Pad thai', grams: 70 },
  ];
}

export const SYNTHETIC: Dataset = {
  source: 'synthetic',
  sourceLabel: 'synthetic',
  fetchedAt: null,
  today: 'Nov 13',
  DAYS,
  PERIOD,
  EXCLUDED: [NOT_COUNTED],
  NOT_COUNTED,
  NOT_COUNTED_CAUSE,
  RUN_DAYS,
  RUN_TIME,
  SCHED,
  LOOP,
  STATE,
  RATE: null,
  AUTO_BOLUS: null,
  SCHED_EFF: null,
  OVERRIDE_HOURS: null,
  G6,
  HOURLY_G: samHourly(),
  PATIENT: { ...PATIENT, first: 'Sam' },
  CGM_NOW,
  HEADS_UP: { ...HEADS_UP, kind: 'low', weekday: 5, stretch: [15, 18] },
  WEEKDAY_GRID: sampleWeekdayGrid(),
  AVG_DAY: AVG_FRIDAY,
  CARE_NOTE,
  LUNCH: { ...LUNCH, beforeLabel: 'Before, 1:10', afterLabel: 'After, 1:9' },
  READ,
  AGP,
  INSULIN,
  DAY: { ...FRIDAY, weekday: 5, name: 'Friday' },
  CHANGES,
  QUESTION,
  PATIENTS,
  TEXT: {
    headsUpBody: 'Friday 3–6pm: 48% of readings below 70 mg/dL, 4 of the last 4 Fridays. Each followed a lunchtime run, 12:15–1:15pm.',
    dayTrackerFinding: 'On the average Friday, glucose is lowest at 4pm, 66 mg/dL, two to three hours after the 1pm run. Active insulin from lunch is still about 1.9 U at 2pm.',
    dayTrackerLoop: 'Loop suspended 3–6pm on both Fridays in this fortnight.',
    loopFinding: 'Most mornings 6–9am, algorithm-modulated basal ran below the scheduled rate. 7–9pm it ran above. Both Fridays show suspension 3–6pm after a 12:15pm run.',
    lunchFinding: 'After the change, median lunch peaks were about 20 mg/dL lower (212 → 192 mg/dL). Same weekday mix; two runs and one pod change fall in the after period.',
    pattern: 'Fridays 3–6pm run low in 48% of readings, 4 of 4 weeks. Each follows a 12:15pm lunchtime run.',
    suspendNote: 'both Fridays after a lunchtime run',
    loopGlance: 'The morning dip is 6–8am: Loop delivered about 40% less than scheduled.',
    eveningNote: '',
    lunchContext: 'Same weekday mix on both sides. Two runs and one pod change fall in the after period.',
    excludedNote: 'Sun Nov 8 isn’t counted',
  },
  DAY_BY_WEEKDAY: [null, null, null, null, null, { ...FRIDAY, weekday: 5, name: 'Friday' }, null, samEveryDay()],
  DAILY: samDaily(),
  MEALS: SAM_MEALS,
  SUGGESTIONS: samSuggestions(),
  THERAPY: { ...realLoopTherapy, from: 'sample' },
  LOWS: computeHypoReport({ glucose: samMeals().glucose.map((g) => ({ iso: new Date(g.at).toISOString(), mgdl: g.mgdl })), target: { lowMgdl: BANDS.low, highMgdl: BANDS.high, urgentLowMgdl: BANDS.urgentLow }, now: new Date(2026, 10, 13), windowDays: 14 }),
};
