# Loop settings (schedule-based therapy)

`src/data/loopTherapy.ts` holds Ryan's real Loop therapy settings, transcribed
from the Loop app. `Insights → Settings` renders them read-only.

## Why schedule-based matters

Loop's carb ratio, ISF, and basal all **change by time of day**. The sample
profile shipped a single carb ratio of 10 g/U; Ryan's real ratio is 25.5–28.5.
The old default over-dosed by ~2.8×. A dose is only correct if it uses the value
active at the moment the meal is eaten — so the resolvers take a `Date`.

## Resolution priority (used by the dose engine)

1. A manual override the user typed under Profile → Targets (`loadTherapyOverrides`).
2. Otherwise the real schedule, resolved at `now` via `carbRatioAt` / `isfAt`.

## What moves and what doesn't

| Setting | Source of truth | Editable in-app? |
|---|---|---|
| In-range TARGET (dashboard TIR) | `loopTherapyStore` override | Yes — Profile → Targets |
| Carb ratio, ISF, basal | `loopTherapy.ts` schedule | No — edit in Loop, re-transcribe |
| Correction range, safety limit, pre-meal, limits | `loopTherapy.ts` | No |

The dashboard **target** and Loop's **correction range** are deliberately
different things and both are shown; do not conflate them.

## Resolver semantics

`valueAt` is cyclic: a time before the first entry falls under the last entry of
the day (standard pump behaviour). Loop schedules always start at 00:00 so the
wrap never fires in practice, but the resolver is correct for any schedule.
`dailyBasalTotal` integrates the schedule over 24h and matches Loop's own
14.82 U/day readout — the test that asserts this is the transcription check.

## When these change

Loop settings are re-transcribed by hand from screenshots (there is no Loop
export API). Update `capturedIso` when you do, and re-verify `dailyBasalTotal`
against Loop's displayed total as a transcription checksum.
