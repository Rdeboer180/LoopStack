// What a note about a meal remembers: the meal, and a plain, frozen description of the numbers as they
// were when the note was written (so a later Nightscout refresh can't change what it was about).
// Observations only (SAFE-1): what happened, never what to change.
import { DATA, PERIOD } from './current';
import { dur, type MealResponse } from './meals';
import { BANDS } from './ranges';
import type { NoteAnchor, NoteSnapshot } from './notes';

const OUTCOME: Record<MealResponse['outcome'], string> = { in: `stayed ${BANDS.low}–${BANDS.high}`, high: `went above ${BANDS.high}`, low: `went below ${BANDS.low}` };

export function mealAnchor(food: string, m: MealResponse): NoteAnchor {
  return { kind: 'meal', food, at: m.at, mealId: m.id };
}

/** The lines a note keeps about a meal. Pure over the meal, for testing. */
export function mealLines(m: MealResponse): string[] {
  return [
    `${m.when}: ${m.carbsG} g with ${m.bolusU} U`,
    `Glucose ${m.startMgdl}, peaked at ${m.peakMgdl} after ${dur(m.peakAfterMin)}, then ${OUTCOME[m.outcome]}`,
    m.observedMin == null ? `Absorption not read yet (${dur(m.enteredMin)} entered)` : `Absorbed in ${dur(m.observedMin)} (${dur(m.enteredMin)} entered)`,
  ];
}

export function mealSnapshot(m: MealResponse): NoteSnapshot {
  return { period: PERIOD.label, source: DATA.source, lines: mealLines(m) };
}
