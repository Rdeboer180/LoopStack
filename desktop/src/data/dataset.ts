// The shape every data source fills: the synthetic patient (synthetic.ts) or
// the person's own Nightscout (nightscout.ts). The views read the active one
// through current.ts. Sentences that state a finding live here as data too,
// so a real dataset never shows a sentence written for the synthetic one.

/** a: about as scheduled (±15%) · l: less · m: more · s: suspended · x: no data */
export type HourState = 'a' | 'l' | 'm' | 's' | 'x';
/** A day label, "Fri 30". */
export type Day = string;
/** [hour of day, mg/dL] */
export type Pt = readonly [number, number];

export interface SettingsChange {
  id: string;
  date: string;
  setting: string;
  from: string;
  to: string;
  proposedBy: string;
  agreedBy: string | null;
  appliedBy: string | null;
  reviewDate: string | null;
  status: 'proposed' | 'agreed' | 'applied' | 'reviewed';
  note: string;
}

export interface ListedPatient {
  id: string;
  name: string;
  initials: string;
  system: string;
  visit: string;
  packet: { shared: string } | null;
  lastPacket: string | null;
  flags: readonly string[];
}

/** One day of glucose: its average and spread, for the Daily glucose tile. */
export interface DailyGlucose {
  /** "Fri 30" */
  day: Day;
  /** "Fri, Oct 30" */
  label: string;
  /** False when the day isn't counted (VIS-4: drawn as missing). */
  usable: boolean;
  meanMgdl: number | null;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
  /** In range, below and above your bands (Settings → Your ranges). */
  inRangePct: number | null;
  belowPct: number | null;
  abovePct: number | null;
  /** Below your urgent low. */
  urgentPct: number | null;
  /** The same against the standard 70–180, for the care-team review. */
  std: { inRangePct: number; belowPct: number; abovePct: number } | null;
  readings: number;
}

export interface Dataset {
  source: 'synthetic' | 'nightscout';
  /** Loop's settings as LoopStack reads them: your Nightscout profile, or the phone app's record for the sample. Read only. */
  THERAPY: import('@/data/loopTherapy').LoopTherapy & { from: 'nightscout' | 'sample' };
  /** Lows and urgent lows over the period, as separate events (15 minutes under, the phone's rule), against your bands. */
  LOWS: import('@/lib/metrics/hypoEvents').HypoReport;
  /** Shown beside the person's name: "synthetic", or the Nightscout host. */
  sourceLabel: string;
  /** When the data was read, ISO; null for the synthetic set. */
  fetchedAt: string | null;
  /** Today's date as the views print it, "Nov 13". */
  today: string;

  DAYS: readonly Day[];
  PERIOD: { label: string; days: number; tolerance: number };
  /** Days left out of the counts, with the reason for the first (VIS-4). */
  EXCLUDED: readonly Day[];
  NOT_COUNTED: Day | null;
  NOT_COUNTED_CAUSE: string;
  /** Days with recorded exercise, and the usual time, for the grid's run marks. */
  RUN_DAYS: readonly Day[];
  RUN_TIME: { start: number; end: number; label: string } | null;

  /** Scheduled basal for each hour, U/h. */
  SCHED: readonly number[];
  /** What Loop delivered, median U/h for each hour over the usable days. */
  LOOP: readonly number[];
  STATE: Readonly<Record<Day, readonly HourState[]>>;
  /** Per-day temp basal delivered, U/hr by hour, when the source has it (null: synthetic, use the board formulas). */
  RATE: Readonly<Record<Day, readonly number[]>> | null;
  /** Loop's automatic boluses, U in each hour of each day (null: the synthetic set has none). */
  AUTO_BOLUS: Readonly<Record<Day, readonly number[]>> | null;
  /** The schedule Loop worked to: scheduled basal × an override's insulin needs, U/hr by hour of each day (null: none). */
  SCHED_EFF: Readonly<Record<Day, readonly number[]>> | null;
  /** The override running for most of each hour, by name (null: none recorded). */
  OVERRIDE_HOURS: Readonly<Record<Day, readonly (string | null)[]>> | null;
  /** Median glucose in each hour of each day, mg/dL; null where there were no readings. */
  HOURLY_G: Readonly<Record<Day, readonly (number | null)[]>>;
  /** Glucose at 6am with its CGM trend arrow. */
  G6: Readonly<Record<Day, { mgdl: number; trend: string } | null>>;

  PATIENT: {
    name: string;
    first: string;
    initials: string;
    setup: string;
    loopedMinAgo: number;
    podAge: string;
    sensorDay: string;
    buildExpiresDays: number | null;
    age: number | null;
    engagement: string;
    clinician: string;
    nextVisit: string;
  };
  CGM_NOW: {
    mgdl: number | null;
    trend: string;
    trendLabel: string;
    ageMin: number;
    statusAt?: string | null;
    activeInsulinU: number | null;
    activeCarbsG: number | null;
    points: readonly Pt[];
    prediction: readonly Pt[];
    /** Every CGM reading of the last 24 hours, hours relative to today's midnight (yesterday is negative), for the 3/6/12/24h view. */
    day?: readonly Pt[];
  };
  /** The day's trend heads-up (PROD-2). Null when no weekday stretch clears the bar. */
  HEADS_UP: {
    when: string;
    title: string;
    detail: string;
    kind: 'low' | 'high';
    /** 0 = Sunday */
    weekday: number;
    /** [start, end) hours */
    stretch: readonly [number, number];
  } | null;
  WEEKDAY_GRID: import('@/lib/metrics/dayHourGrid').DayHourGrid;
  /** Median glucose on the tracked weekday, for the heads-up chart. */
  AVG_DAY: readonly Pt[];
  CARE_NOTE: { from: string; date: string; text: string } | null;
  LUNCH: {
    change: string;
    source: string;
    reviewDate: string;
    scope: readonly [number, number];
    before: readonly Pt[];
    after: readonly Pt[];
    usable: { before: number; after: number; days: number };
    /** Labels for the two sides of the chart. */
    beforeLabel: string;
    afterLabel: string;
  };
  READ: {
    sensorWornPct: number;
    veryLowPct: number;
    lowPct: number;
    inRangePct: number;
    highPct: number;
    veryHighPct: number;
    inRangeSinceLastVisit: number | null;
    /** The equal-length period before, scored the same way (your bands for inRangePct); null when it had too little sensor data. */
    prev: { inRangePct: number; meanMgdl: number; gmiPct: number; cvPct: number } | null;
    automationPct: number;
    automationGaps: string;
    gmiPct: number;
    cvPct: number;
    meanMgdl: number;
    /** The five bands against your own ranges (urgent low, low, in range, high, very high). */
    mine: import('./ranges').BandRead;
  };
  AGP: { hours: readonly number[]; p5: readonly number[]; p25: readonly number[]; p50: readonly number[]; p75: readonly number[]; p95: readonly number[] };
  INSULIN: { totalDailyU: number; algorithmPct: number; userPct: number; overrideHoursPerWeek: number; presets: string };
  /** The day tracker: the average of one weekday, hour by hour (PROD-2). */
  DAY: {
    weekday: number;
    /** "Friday" */
    name: string;
    glucose: readonly number[];
    iob: readonly number[];
    cob: readonly number[];
    exercise: Readonly<Record<number, number>>;
    weeks: number;
    /** Days that went into it, when it covers more than one weekday (every day, weekdays, weekends). */
    days?: number;
    stretch: readonly [number, number] | null;
  };
  CHANGES: readonly SettingsChange[];
  QUESTION: {
    date: string;
    text: string;
    options: readonly { id: string; label: string; how: string }[];
    attached: string;
  } | null;
  PATIENTS: readonly ListedPatient[];

  /** Finding sentences, computed per source. Observations only (SAFE-1). */
  TEXT: {
    headsUpBody: string;
    dayTrackerFinding: string;
    dayTrackerLoop: string;
    loopFinding: string;
    lunchFinding: string;
    pattern: string;
    /** Appended to "Loop suspended on N of M days"; empty for none. */
    suspendNote: string;
    /** The one-line lead on the What Loop did tile. */
    loopGlance: string;
    /** The evenings note beside the grid; empty to hide it. */
    eveningNote: string;
    /** What else differs between the before and after sides. */
    lunchContext: string;
    /** Why a day was left out, for captions; empty when none was. */
    excludedNote: string;
  };
  /** Glucose day by day across the period, and today so far. */
  DAILY: { days: readonly DailyGlucose[]; today: DailyGlucose | null };
  /** Meal response: each carb entry and what followed, grouped by meal name. */
  MEALS: import('./meals').Meals;
  /** What LoopStack's readings point at, settings and favorite foods, with a confidence grade each (SAFE-5a). */
  SUGGESTIONS: readonly import('./suggestions').Suggestion[];
  /** The day tracker for each weekday (0 = Sunday … 6 = Saturday) and 7 = every day; null where there isn't enough data. */
  /** 0–6 Sunday to Saturday, 7 every day, 8 weekdays (Mon–Fri), 9 weekends. */
  DAY_BY_WEEKDAY: readonly (Dataset['DAY'] | null)[];
}
