import { describe, expect, it } from 'vitest';
import { hourSummary } from './hourSummary';
import { checkCopyAll } from './safeCopy.testutil';
import { buildNightscoutDataset, scheduleAt, type NsRaw } from './nightscout';

// A made-up Nightscout: 35 days, glucose 120 with a dip to 60 on Friday
// afternoons, scheduled basal 1.0 U/h, Loop running a 0.5 U/h temp 6–8am every
// day, and one day with no CGM at all. "Now" is Friday Nov 13, 2026, 9am local.
const NOW = new Date(2026, 10, 13, 9, 0).getTime();
const HOUR = 3_600_000;
const MIN = 60_000;

function fixture(): NsRaw {
  const entries: NsRaw['entries'] = [];
  const treatments: NsRaw['treatments'] = [];
  const devicestatus: NsRaw['devicestatus'] = [];
  const gapDay = new Date(2026, 10, 8).getTime(); // Sun Nov 8: no CGM, no Loop
  for (let t = NOW - 35 * 24 * HOUR; t <= NOW; t += 5 * MIN) {
    const d = new Date(t);
    const day0 = new Date(d); day0.setHours(0, 0, 0, 0);
    if (day0.getTime() === gapDay) continue;
    const h = d.getHours();
    const sgv = d.getDay() === 5 && h >= 15 && h < 18 ? 60 : 120;
    entries.push({ date: t, sgv, direction: 'Flat', device: 'Dexcom G7' });
    devicestatus.push({ created_at: d.toISOString(), loopAt: d.toISOString(), iob: h === 13 ? 2 : 0.5, cob: h === 12 ? 40 : 0, version: 'Loop 3.6', pump: 'Omnipod DASH' });
    if (h === 6 && d.getMinutes() === 0) treatments.push({ created_at: d.toISOString(), eventType: 'Temp Basal', rate: 0.5, absolute: 0.5, duration: 120 });
  }
  const last = new Date(NOW);
  devicestatus.push({ created_at: last.toISOString(), loopAt: last.toISOString(), iob: 1.2, cob: 10, predicted: { startDate: last.toISOString(), values: [120, 118, 116, 115] } });
  const flat = (v: number) => [{ time: '00:00', timeAsSeconds: 0, value: v }];
  const profile = (start: number, cr: number) => ({ startDate: new Date(start).toISOString(), basal: flat(1), carbratio: flat(cr), sens: flat(45), targetLow: flat(100), targetHigh: flat(110), units: 'mg/dl' });
  return {
    site: 'example.nightscout.test',
    name: 'Ryan',
    fetchedAt: new Date(NOW).toISOString(),
    entries,
    treatments,
    devicestatus,
    profiles: [profile(NOW - 60 * 24 * HOUR, 10), profile(NOW - 10 * 24 * HOUR, 9)],
  };
}

describe('Nightscout dataset', () => {
  const ds = buildNightscoutDataset(fixture());

  it('covers the last 14 full days and leaves out the day with no data', () => {
    expect(ds.DAYS).toHaveLength(14);
    expect(ds.PERIOD.label).toBe('Oct 30 – Nov 12');
    expect(ds.EXCLUDED).toEqual(['Sun 8']);
    expect(ds.NOT_COUNTED_CAUSE).toMatch(/CGM readings 0%/);
    expect(ds.TEXT.excludedNote).toBe('Sun Nov 8 isn’t counted');
  });

  it('reads what Loop delivered against the schedule, hour by hour', () => {
    expect(ds.SCHED[6]).toBe(1);
    expect(ds.LOOP[6]).toBe(0.5);
    expect(ds.LOOP[12]).toBe(1);
    expect(ds.STATE['Mon 2'][6]).toBe('l');
    expect(ds.STATE['Mon 2'][7]).toBe('l');
    expect(ds.STATE['Mon 2'][12]).toBe('a');
    expect(ds.STATE['Sun 8'][12]).toBe('x');
    expect(ds.TEXT.loopGlance).toBe('Morning 6–8am: Loop delivered about 50% less than scheduled.');
  });

  it('carries the standard read, five bands adding to 100', () => {
    const r = ds.READ;
    expect(Math.round((r.veryLowPct + r.lowPct + r.inRangePct + r.highPct + r.veryHighPct) * 10) / 10).toBe(100);
    expect(r.sensorWornPct).toBe(93); // 13 of 14 days
    expect(r.lowPct).toBeGreaterThan(0);
  });

  it('finds the Friday afternoon low as today’s heads-up (PROD-2)', () => {
    expect(ds.HEADS_UP?.weekday).toBe(5);
    expect(ds.HEADS_UP?.kind).toBe('low');
    expect(ds.HEADS_UP?.stretch).toEqual([15, 18]);
    expect(ds.DAY.name).toBe('Friday');
    expect(ds.DAY.glucose[16]).toBe(60);
    expect(ds.DAY_BY_WEEKDAY.filter(Boolean).length).toBeGreaterThanOrEqual(6);
  });

  it('shows the dates behind the heads-up and limits the AI preview to the selected hour', () => {
    const cell = ds.WEEKDAY_GRID.days[5].hours[15];
    expect(cell.weeksVoted).toBe(5);
    expect(cell.samples).toHaveLength(5);
    expect(cell.samples?.every(s => s.count === 12 && s.below === 12)).toBe(true);
    const summary = hourSummary(ds, { weekday: 5, hour: 15 });
    expect(summary).toMatchObject({ source: 'Nightscout', countedReadings: 60, readingsBelowPct: 100 });
    expect(JSON.stringify(summary)).not.toMatch(/firstIso|example.nightscout|Ryan/);
  });

  it('keeps partial hours inspectable without awarding them a vote or a percent', () => {
    const raw = fixture();
    const start = new Date(2026, 10, 6, 15).getTime();
    raw.entries = raw.entries.filter(e => e.date >= start && e.date < start + 20 * MIN);
    const partial = buildNightscoutDataset(raw);
    expect(partial.WEEKDAY_GRID.days[5].hours[15].samples?.[0].count).toBe(4);
    expect(hourSummary(partial, { weekday: 5, hour: 15 })).toMatchObject({ partialWeeks: 1, countedWeeks: 0, countedReadings: 0, readingsBelowPct: null });
    expect(partial.WEEKDAY_GRID.days[6].hours[15].samples).toEqual([]);
  });

  it('records the carb ratio change from the profile history', () => {
    const c = ds.CHANGES[0];
    expect(c.setting).toBe('Carb ratio');
    expect(`${c.from} → ${c.to}`).toBe('1:10 → 1:9');
    expect(c.status).toBe('applied');
    expect(ds.LUNCH.change).toMatch(/^Carb ratio 1:10 → 1:9 on Nov 3$/);
  });

  it('reads now: glucose, trend, Loop’s prediction', () => {
    expect(ds.CGM_NOW.mgdl).toBe(120);
    expect(ds.CGM_NOW.trend).toBe('→');
    expect(ds.CGM_NOW.activeInsulinU).toBe(1.2);
    expect(ds.CGM_NOW.prediction).toHaveLength(4);
    expect(ds.PATIENT.setup).toBe('Loop 3.6 · Omnipod DASH · Dexcom G7');
  });

  it('writes observations, never instructions (SAFE-1)', () => {
    expect(checkCopyAll(Object.values(ds.TEXT))).toEqual([]);
  });
});

describe('schedules', () => {
  it('picks the entry in force at a time of day', () => {
    const s = [{ timeAsSeconds: 0, value: 0.8 }, { timeAsSeconds: 6 * 3600, value: 1.1 }];
    expect(scheduleAt(s, 5 * 3600)).toBe(0.8);
    expect(scheduleAt(s, 7 * 3600)).toBe(1.1);
  });
});
