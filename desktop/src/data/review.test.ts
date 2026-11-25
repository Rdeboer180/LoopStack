import { describe, expect, it } from 'vitest';
import { reviewRead, tldrLines } from './review';
import { READ } from './current';

describe('care-team review read (VIS-10)', () => {
  const read = reviewRead();
  const at = (k: string) => read.findIndex((r) => r.key === k);
  it('reads enough data, then lows, then time in range, then the curve', () => {
    expect(at('sensor')).toBe(0);
    expect(at('sensor')).toBeLessThan(at('lows'));
    expect(at('lows')).toBeLessThan(at('tir'));
    expect(at('tir')).toBeLessThan(at('agp'));
    expect(read.filter((r) => r.step != null).map((r) => r.key)).toEqual(['sensor', 'lows', 'tir', 'agp']);
    expect(read.filter((r) => r.step != null).map((r) => r.step)).toEqual([1, 2, 3, 4]);
  });
  it('carries the packet numbers', () => {
    expect(read[0].value).toBe('96%');
    expect(read[1].value).toBe('0.4 · 1.7%');
    expect(read[2].value).toBe('74%');
  });
  it('has five bands that add to 100', () => {
    const sum = READ.veryLowPct + READ.lowPct + READ.inRangePct + READ.highPct + READ.veryHighPct;
    expect(Math.round(sum * 10) / 10).toBe(100);
  });
  it('words the TLDR in clinician terms, as observations', () => {
    const lines = tldrLines();
    expect(lines.map((l) => l.title)).toEqual(['Pattern', 'What Loop did', 'Since last visit']);
    expect(lines[1].text).toMatch(/algorithm-modulated/);
    expect(lines[1].text).toMatch(/12 of 14 days, a median 0.42 U\/hr below/); // the same detector as What Loop did
    expect(lines[2].text).toMatch(/20 mg\/dL lower/);
    for (const l of lines) expect(l.text).not.toMatch(/\b(?:increase|lower|raise) your\b/i);
  });
});
