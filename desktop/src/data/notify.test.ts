import { describe, expect, it } from 'vitest';
import { defaultPrefs } from '@/data/notificationPrefs';
import { MAC_CATEGORIES, macQueue } from './notify';

describe('notifications on this Mac', () => {
  it('queues nothing until the master switch is on', () => {
    expect(macQueue(defaultPrefs(), new Date(2026, 10, 13, 9))).toEqual([]);
  });
  it('queues only what the Mac can work out, soonest first', () => {
    const q = macQueue({ ...defaultPrefs(), enabled: true }, new Date(2026, 10, 13, 9));
    expect(q.every((a) => MAC_CATEGORIES.has(a.category))).toBe(true);
    expect(q.map((a) => a.fireAtIso)).toEqual([...q.map((a) => a.fireAtIso)].sort());
    for (const a of q) expect(`${a.title} ${a.body}`).not.toMatch(/\b(bolus|take|dose|units?)\b/i);
  });
});
