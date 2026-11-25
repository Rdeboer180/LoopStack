import { describe, expect, it } from 'vitest';
import { gradeWord, scoreToGrade, toGrade } from './confidenceGrade';

describe('confidenceGrade', () => {
  it('names the three grades', () => {
    expect(gradeWord('good')).toBe('Readable');
    expect(gradeWord('limited')).toBe('Caveated');
    expect(gradeWord('unusable')).toBe('Not enough data');
  });
  it('cuts at 80 and 55', () => {
    expect(scoreToGrade(100)).toBe('good');
    expect(scoreToGrade(80)).toBe('good');
    expect(scoreToGrade(79)).toBe('limited');
    expect(scoreToGrade(55)).toBe('limited');
    expect(scoreToGrade(54)).toBe('unusable');
    expect(scoreToGrade(0)).toBe('unusable');
    expect(scoreToGrade(NaN)).toBe('unusable');
  });
  it('prefers the score, and falls back to the level', () => {
    expect(toGrade('low', 90)).toBe('good');
    expect(toGrade('high', 40)).toBe('unusable');
    expect(toGrade('low')).toBe('unusable');
    expect(toGrade('medium')).toBe('limited');
    expect(toGrade('high')).toBe('good');
  });
});
