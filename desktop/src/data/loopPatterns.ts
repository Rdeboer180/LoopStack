// The inputs What Loop did reads, from the dataset on screen: shared so every
// place that describes Loop's delivery uses one detector (the review's TLDR too).
import { AUTO_BOLUS, OVERRIDE_HOURS, SCHED_EFF, DAYS, HOURLY_G, RATE, RUN_DAYS, RUN_TIME, SCHED, STATE } from './current';
import { morningValue } from './derive';
import type { PatternInputs } from './patterns';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function loopPatternInputs(): PatternInputs {
  return {
    days: DAYS,
    sched: SCHED,
    state: STATE,
    rate: RATE ? (d, h) => RATE![d][h] : (d, h) => morningValue(DAYS.indexOf(d), h),
    autoBolus: AUTO_BOLUS ? (d, h) => AUTO_BOLUS![d]?.[h] ?? 0 : undefined,
    schedOf: SCHED_EFF ? (d, h) => SCHED_EFF![d]?.[h] ?? SCHED[h] : undefined,
    overrideAt: OVERRIDE_HOURS ? (d, h) => OVERRIDE_HOURS![d]?.[h] ?? null : undefined,
    hourlyGlucose: HOURLY_G,
    weekdayOf: (d) => WD.indexOf(d.split(' ')[0]),
    workoutDays: RUN_DAYS,
    workoutHour: RUN_TIME?.start ?? null,
  };
}

