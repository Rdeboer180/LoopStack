// The sample patient's longer history, for the 30, 90 and 180-day periods. The 14-day sample stays
// the hand-written one (synthetic.ts), so the boards and the demo agree number for number; longer
// periods come from this made-up Nightscout record, run through the same builder real data uses.
// Every number here is synthetic. Deterministic, so the same period always reads the same.
import type { Dataset } from './dataset';
import { buildNightscoutDataset, type NsEntry, type NsProfile, type NsRaw, type NsStatus, type NsTreatment } from './nightscout';
import { SYNTHETIC } from './synthetic';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** "Now" for the sample: the morning after its 14-day period (Oct 30 – Nov 12). */
export const SAMPLE_NOW = new Date(2026, 10, 13, 9, 15).getTime();
const HISTORY_DAYS = 190;

/** A repeatable pseudo-random number in [0, 1) for an integer seed. */
function rand(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// The same day shape as the hand-written sample: dawn dip, lunch and dinner rises.
const SHAPE = [132, 128, 122, 116, 110, 104, 96, 101, 118, 134, 128, 124, 142, 165, 150, 118, 98, 104, 138, 176, 182, 164, 148, 138];
const SCHED_BASAL = [0.85, 0.85, 0.8, 0.8, 0.85, 0.9, 0.95, 0.92, 0.9, 0.85, 0.8, 0.8, 0.85, 0.85, 0.8, 0.8, 0.85, 0.85, 0.9, 0.9, 0.95, 0.9, 0.9, 0.85];
const MEALS = [
  { name: '🥣 Oatmeal + berries', hour: 7.5, g: 45, abs: 180, u: 4.5 },
  { name: '🌯 Burrito bowl', hour: 12.25, g: 70, abs: 240, u: 7 },
  { name: '🥗 Chicken salad', hour: 12.5, g: 25, abs: 120, u: 2.5 },
  { name: '🍕 Pizza (2 slices)', hour: 18.75, g: 75, abs: 300, u: 7.5 },
  { name: '🍝 Pasta', hour: 18.5, g: 65, abs: 240, u: 6.5 },
];

function profile(): NsProfile {
  const sched = (vals: number[]) => vals.map((value, h) => ({ time: `${String(h).padStart(2, '0')}:00`, timeAsSeconds: h * 3600, value }));
  return {
    startDate: new Date(SAMPLE_NOW - HISTORY_DAYS * DAY - DAY).toISOString(),
    basal: sched(SCHED_BASAL),
    carbratio: [{ time: '00:00', timeAsSeconds: 0, value: 10 }],
    sens: [{ time: '00:00', timeAsSeconds: 0, value: 45 }],
    targetLow: [{ time: '00:00', timeAsSeconds: 0, value: 100 }],
    targetHigh: [{ time: '00:00', timeAsSeconds: 0, value: 110 }],
    units: 'mg/dl',
  };
}

let cached: NsRaw | null = null;

/** About six months of made-up CGM, meals, boluses, temp basals and Loop status. */
export function sampleRaw(): NsRaw {
  if (cached) return cached;
  const start = new Date(SAMPLE_NOW - HISTORY_DAYS * DAY); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const entries: NsEntry[] = [];
  const treatments: NsTreatment[] = [];
  const devicestatus: NsStatus[] = [];
  const meals: { at: number; g: number; abs: number; u: number }[] = [];

  for (let d = 0; t0 + d * DAY < SAMPLE_NOW; d += 1) {
    const day = t0 + d * DAY;
    const wd = new Date(day).getDay();
    // Breakfast most days, one lunch, one dinner; pizza on Fridays.
    const picks = [
      rand(d * 11) < 0.85 ? MEALS[0] : null,
      rand(d * 13) < 0.5 ? MEALS[1] : MEALS[2],
      wd === 5 ? MEALS[3] : rand(d * 17) < 0.45 ? MEALS[4] : null,
    ].filter((m): m is (typeof MEALS)[number] => m !== null);
    for (const m of picks) {
      const at = day + (m.hour + (rand(d * 31 + m.g) - 0.5) * 0.6) * 60 * MIN;
      if (at >= SAMPLE_NOW) continue;
      const g = Math.round(m.g * (0.85 + rand(d * 37 + m.g) * 0.3));
      const u = Math.round((g / 10) * 20) / 20;
      meals.push({ at, g, abs: m.abs, u });
      const iso = new Date(at).toISOString();
      treatments.push({ created_at: iso, eventType: 'Carb Correction', carbs: g, absorptionTime: m.abs, foodType: m.name });
      treatments.push({ created_at: iso, eventType: 'Correction Bolus', insulin: u, automatic: false });
    }
    // Loop's temp basals: under the schedule most mornings 6–8am, over it most evenings 7–9pm, suspended after Friday's run.
    for (let h = 0; h < 24; h += 1) {
      const at = day + h * 60 * MIN;
      if (at >= SAMPLE_NOW) break;
      let f = 0.9 + rand(d * 101 + h) * 0.2;
      if (h >= 6 && h < 8 && rand(d * 103 + h) < 0.85) f = 0.55 + rand(d * 107) * 0.15;
      if (h >= 19 && h < 21 && rand(d * 109 + h) < 0.5) f = 1.15 + rand(d * 113) * 0.15;
      if (wd === 5 && h >= 15 && h < 18) f = 0;
      treatments.push({ created_at: new Date(at).toISOString(), eventType: 'Temp Basal', duration: 60, rate: Math.round(SCHED_BASAL[h] * f * 100) / 100, absolute: Math.round(SCHED_BASAL[h] * f * 100) / 100, automatic: true });
    }
  }

  // Glucose every 5 minutes: the day shape, meal rises, a Friday-afternoon low, and a slow drift.
  let walk = 0;
  for (let t = t0, i = 0; t < SAMPLE_NOW; t += 5 * MIN, i += 1) {
    const dt = new Date(t);
    const h = dt.getHours() + dt.getMinutes() / 60;
    const a = SHAPE[Math.floor(h) % 24];
    const b = SHAPE[(Math.floor(h) + 1) % 24];
    let g = a + (b - a) * (h - Math.floor(h)) - 10;
    let iob = 0.4;
    for (const m of meals) {
      const x = (t - m.at) / MIN;
      if (x < 0 || x > m.abs * 1.3) continue;
      g += (m.g * 0.9) * Math.sin(Math.min(1, x / (m.abs * 0.35)) * (Math.PI / 2)) * Math.max(0, 1 - Math.max(0, x - m.abs * 0.35) / m.abs);
      iob += x < 240 ? m.u * Math.max(0, 1 - x / 240) : 0;
    }
    if (dt.getDay() === 5 && h >= 14.5 && h < 18) g -= 40 * Math.sin(((h - 14.5) / 3.5) * Math.PI);
    walk = walk * 0.97 + (rand(i * 7 + 3) - 0.5) * 6;
    g = Math.round(Math.max(48, Math.min(330, g + walk)));
    // A few sensor gaps: warm-ups every 10 days.
    if (Math.floor((t - t0) / DAY) % 10 === 0 && h < 2) continue;
    entries.push({ date: t, sgv: g, direction: 'Flat' });
    devicestatus.push({ created_at: dt.toISOString(), loopAt: dt.toISOString(), iob: Math.round(iob * 100) / 100, cob: null, failed: false, version: 'Loop 3.6', pump: 'Omnipod DASH', system: 'Loop', predicted: null });
  }
  devicestatus.reverse();

  cached = { site: 'sample', name: SYNTHETIC.PATIENT.name, fetchedAt: new Date(SAMPLE_NOW).toISOString(), entries, treatments, devicestatus, profiles: [profile()] };
  return cached;
}

const built = new Map<number, Dataset>();

/** The sample patient for a period: the hand-written 14 days, or a longer period from the made-up history. */
export function sampleFor(days: number): Dataset {
  if (days <= 14) return SYNTHETIC;
  const hit = built.get(days);
  if (hit) return hit;
  const ds = buildNightscoutDataset(sampleRaw(), { days, now: SAMPLE_NOW });
  // Keep the sample patient's identity, care-team thread and question; the numbers come from the longer history.
  const out: Dataset = {
    ...ds,
    source: 'synthetic',
    sourceLabel: 'synthetic',
    today: SYNTHETIC.today,
    PATIENT: { ...ds.PATIENT, ...SYNTHETIC.PATIENT },
    PATIENTS: SYNTHETIC.PATIENTS,
    QUESTION: SYNTHETIC.QUESTION,
    CARE_NOTE: SYNTHETIC.CARE_NOTE,
    CGM_NOW: SYNTHETIC.CGM_NOW,
    SUGGESTIONS: SYNTHETIC.SUGGESTIONS,
  };
  built.set(days, out);
  return out;
}
