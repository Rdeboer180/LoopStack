import { describe, expect, it } from 'vitest';
import { DATA } from './current';
import { buildGlance, STALE_MIN } from './glance';

const RYAN = { urgentLow: 60, low: 65, high: 180 };

describe('glance', () => {
  const g = buildGlance(DATA, RYAN);

  it('leads with in range and the average, from your bands', () => {
    expect(g.headline).toBe(`${Math.round(DATA.READ.mine.inRangePct)}% in range, average ${Math.round(DATA.READ.meanMgdl)}`);
    expect(g.tir.range).toBe('65–180');
    expect(g.periodLabel).toBe(`${DATA.PERIOD.days}d`);
  });

  it('names insulin as Loop-adjusted and you-started, never a ratio', () => {
    expect(g.insulin.loopPct! + g.insulin.youPct!).toBe(100);
    expect(JSON.stringify(g)).not.toMatch(/basal|bolus/i);
  });

  it('shows the last week of days and today, today last', () => {
    expect(g.week.length).toBeLessThanOrEqual(8);
    expect(g.week[g.week.length - 1].today).toBe(true);
    expect(g.week.filter((d) => d.today)).toHaveLength(1);
  });

  it('greys out a reading older than 15 minutes and says so', () => {
    const old = buildGlance({ ...DATA, CGM_NOW: { ...DATA.CGM_NOW, ageMin: STALE_MIN + 3 } }, RYAN);
    expect(old.now.stale).toBe(true);
    expect(old.now.tone).toBe('stale');
    expect(old.now.status).toBe(`Last reading ${STALE_MIN + 3} min ago, not live`);
    expect(old.now.arrow).toBe('');
  });

  it('shows dashes, not zeros, before there are readings', () => {
    const none = buildGlance({ ...DATA, READ: { ...DATA.READ, meanMgdl: 0 } }, RYAN);
    expect(none.avg.mgdl).toBeNull();
    expect(none.headline).toBe('No readings in this period yet');
  });
});
