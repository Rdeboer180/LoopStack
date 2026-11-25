import type { ConfidenceLevel, ConfidenceScore } from '@/data/types';
import type { PortableConfidence } from './transfer';

// The words a person sees for the shared grades. Same words on the desktop.
const WORDS: Record<PortableConfidence, string> = {
  good: 'Readable',
  limited: 'Caveated',
  unusable: 'Not enough data',
};

export function gradeWord(grade: PortableConfidence): string {
  return WORDS[grade];
}

// Thresholds on the phone's 0-100 confidenceScore:
//   80 and above  -> good     (the same bar as the 'ready' tier in confidence.ts)
//   55 to 79      -> limited
//   below 55      -> unusable
// Without a score, the low / medium / high level stands in at its default
// score (low 25, medium 55, high 85), so medium lands on limited.
const LEVEL_SCORE: Record<ConfidenceLevel, number> = { low: 25, medium: 55, high: 85 };

export function scoreToGrade(score: number): PortableConfidence {
  if (!Number.isFinite(score)) return 'unusable';
  if (score >= 80) return 'good';
  if (score >= 55) return 'limited';
  return 'unusable';
}

export function toGrade(level: ConfidenceLevel, score?: ConfidenceScore): PortableConfidence {
  return scoreToGrade(score ?? LEVEL_SCORE[level]);
}
