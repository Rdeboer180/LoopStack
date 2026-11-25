// Plain words for the "What we've learned about you" card, shared by the phone
// (Profile → LearnedProfile) and the desktop (Settings → What we've learned) so
// both say the same thing. Context only: nothing here is advice (SAFE-1).
import type { DietaryPreferences as Prefs } from './types';

export const patternLabel: Record<Prefs['pattern'], string> = {
  none: 'No strong pattern',
  vegetarian: 'Plant-forward (vegetarian)',
  vegan: 'Plant-based (vegan)',
  pescatarian: 'Pescatarian',
  mediterranean: 'Mediterranean',
  low_carb: 'Lower-carb',
  keto: 'Ketogenic',
};

export function carbLoadLabel(d: Prefs): string {
  const plant = d.foodMix.wholePlantFoods;
  const refined = d.foodMix.refinedCarbs;
  if (plant === 'often' && refined !== 'often') return 'High-carb, high-fiber';
  if (refined === 'often') return 'High-carb, more refined';
  return 'Moderate carbohydrate';
}

export function fatSignalLabel(d: Prefs): string {
  switch (d.fatSensitivity) {
    case 'low': return 'Low late-fat delay';
    case 'moderate': return 'Some late-fat delay';
    case 'high': return 'Strong late-fat delay';
  }
}

export function rhythmLabel(d: Prefs): string {
  switch (d.variance.consistency) {
    case 'consistent': return 'Consistent day to day';
    case 'weekend_shift': return 'Weekends shift later';
    case 'highly_variable': return 'Varies day to day';
  }
}

/** The four rows, in the order both apps show them. */
export const learnedRows = (d: Prefs): readonly (readonly [string, string])[] => [
  ['Eating pattern', patternLabel[d.pattern]],
  ['Typical carb load', carbLoadLabel(d)],
  ['Fat response', fatSignalLabel(d)],
  ['Weekly rhythm', rhythmLabel(d)],
];

export type LearnedFeedback = 'confirmed' | 'flagged' | null;
export const LEARNED_FEEDBACK_KEY = 'loopstack:learnedProfileFeedback:v1';
export function loadLearnedFeedback(): LearnedFeedback {
  try {
    const raw = localStorage.getItem(LEARNED_FEEDBACK_KEY);
    return raw === 'confirmed' || raw === 'flagged' ? raw : null;
  } catch { return null; }
}
export function saveLearnedFeedback(f: LearnedFeedback): void {
  try {
    if (f == null) localStorage.removeItem(LEARNED_FEEDBACK_KEY);
    else localStorage.setItem(LEARNED_FEEDBACK_KEY, f);
  } catch { /* session-only */ }
}
