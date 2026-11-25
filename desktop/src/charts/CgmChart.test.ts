import { describe, expect, it } from 'vitest';
import { clockOf, tickStep, toneOf, yTop } from './CgmChart';
import { CGM_NOW } from '../data/synthetic';

const B = { low: 65, high: 180 };

describe('the glucose-now chart', () => {
  it('colours each reading by your bands', () => {
    expect(toneOf(64, B)).toBe('low');
    expect(toneOf(65, B)).toBe('in');
    expect(toneOf(180, B)).toBe('in');
    expect(toneOf(181, B)).toBe('high');
  });

  it('scales like a CGM: at least 250, up in 50s, never past 400', () => {
    expect(yTop([110, 150])).toBe(250);
    expect(yTop([262])).toBe(300);
    expect(yTop([520])).toBe(400);
    expect(yTop([])).toBe(250);
  });

  it('labels hours more sparsely as the window widens', () => {
    expect(tickStep(3)).toBe(1);
    expect(tickStep(12)).toBe(2);
    expect(tickStep(24)).toBe(3);
  });

  it('tells a reading’s time, yesterday included', () => {
    expect(clockOf(9.25)).toBe('9:15a');
    expect(clockOf(-1.5)).toBe('10:30p');
    expect(clockOf(13.999)).toBe('2:00p');
  });

  it('the sample day is 24 hours of 5-minute readings ending at the latest one, with one dip under 65', () => {
    const day = CGM_NOW.day;
    expect(day.length).toBe(289);
    expect(day[day.length - 1]).toEqual(CGM_NOW.points[CGM_NOW.points.length - 1]);
    expect(day.some(([, v]) => v < 65)).toBe(true);
  });
});
