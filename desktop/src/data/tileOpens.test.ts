import { describe, expect, it } from 'vitest';
import { mostOpened } from './tileOpens';

describe('tile opens', () => {
  const now = Date.UTC(2026, 10, 21);
  const day = 86_400_000;
  it('counts the last 30 days only, most opened first', () => {
    const r = mostOpened(now, { meals: [now - day, now - 2 * day, now - 40 * day], 'device-life': [now - day], 'care-thread': [now - 31 * day] });
    expect(r).toEqual([{ kind: 'meals', n: 2 }, { kind: 'device-life', n: 1 }]);
  });
  it('ignores malformed records', () => {
    expect(mostOpened(now, { meals: 'x' as unknown as number[] })).toEqual([]);
  });
});
