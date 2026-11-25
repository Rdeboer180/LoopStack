import type { UserProfile } from './types';

export const sampleUserProfile: UserProfile = {
  id: 'u_ryan',
  displayName: 'Ryan',
  diagnosedOn: '2011-08-14',
  diabetesType: 't1',
  ageRange: '30-44',
  typicalRoutine: 'flexible',
  // Derived diet context (no longer self-reported). Reflects a ~90% plant-based,
  // high-carb, high-fiber eater: low late-fat delay, no notable protein tail,
  // whole-plant-heavy with modest refined carbs. Feeds the context-only engine in
  // dietaryLoopSuggestions.ts until the meal-trace learner computes it directly.
  dietary: {
    pattern: 'vegan',
    fatSensitivity: 'low',
    observesProteinImpact: false,
    foodMix: {
      wholePlantFoods: 'often',
      refinedCarbs: 'sometimes',
      saturatedFats: 'rarely',
      unsaturatedFats: 'often',
      acidsFermented: 'often',
    },
    variance: {
      consistency: 'weekend_shift',
      weekendShifts: ['more_eating_out', 'later_eating'],
    },
  },
  connections: [
    { id: 'apple_health', label: 'Apple Health', connected: true, lastSync: '2026-04-21T11:40:00Z' },
    { id: 'dexcom', label: 'Dexcom', connected: true, lastSync: '2026-04-21T12:02:00Z' },
    { id: 'loop', label: 'Loop', connected: true, lastSync: '2026-04-21T12:02:00Z' },
    { id: 'nightscout', label: 'Nightscout', connected: false },
  ],
  fitness: {
    delta14d: +0.12,
    isfMultiplier: 0.92,
    summary:
      // No dose direction or magnitude in a static seed string: "~8% less
      // insulin than baseline" is a dosing claim presented as a measurement,
      // from a file that measured nothing. State the observation, stop there.
      'Cardiovascular load is up 12% over the last 14 days. Sustained training loads are associated with higher insulin sensitivity — the Tuning hub reads yours from your own data.',
    source: 'apple_health',
    confidence: 'medium',
  },
  // Target range (targetLow/High) is the dashboard's in-range definition and
  // stays editable. Carb ratio and ISF here are representative midday values —
  // the AUTHORITATIVE, time-of-day settings live in loopTherapy.ts and are what
  // the dose engine actually resolves against. See realLoopTherapy.
  clinical: {
    urgentLowMgdl: 60,
    targetLowMgdl: 65,
    targetHighMgdl: 180,
    baseIsf: 44,
    observedIsf: 46,
    carbRatio: 27.8,
    insulinDurationHours: 6,
    observedIsfMeta: {
      trend: 'up',
      confidence: 'medium',
      confidenceScore: 72,
      evidenceCount: 18,
      lastUpdatedIso: '2026-07-23T11:18:00Z',
    },
  },
  strategyPrefs: {
    defaultUpfrontPct: 50,
    defaultExtendedHours: 3,
    showSplitSuggestions: true,
  },
};
