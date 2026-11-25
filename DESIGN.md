# Design System: LoopStack

The visual and data-visual rules for both LoopStack surfaces: the **phone
app** and the **desktop app** (My dashboard and Care-team review). PRODUCT.md holds who it's
for, the clinical-safety commitments and the process. When code and these
files disagree, ask which one is wrong.

Detail lives in the docs this file names; this file holds the **named rules**
the governance server (`loopstack-system`, see AGENTS.md) searches and checks
against. Each named rule has a stable id.

## Overview

Calm, airy, Withings-influenced: white and near-white surfaces, ink text, one
green accent used sparingly, glucose colours only where they carry glucose
meaning. Dense data is allowed; dense screens are not. Every screen leads with
the simple read, and the detail is one deliberate tap away.

Sources: `docs/visual-system.md` (the full contract), `docs/brand.md` (mark,
wordmark, tagline), `src/styles/tokens.css` (every colour, space and radius).

## Colors

Tokens live in `src/styles/tokens.css`. A raw hex anywhere else is drift.

Desktop appearance supports Light, Dark and System. Dark overrides the same
semantic roles under `:root[data-theme='dark']` in the token file. This applies
to surfaces, ink, links and glass fallback colours; chart hues retain their
meaning. System follows OS changes. Named desktop layouts save appearance with
the widget arrangement. See `references/core-ui-elements/patterns/saved-layouts.md`.

### Surface and ink
- `--surface-0` #FFFFFF canvas and cards · `--surface-1` #F6F7F8 fills ·
  `--surface-2` #EDEEF0 dividers, chips.
- `--ink-900` #0E1216 primary text · `--ink-700` #3C434A body ·
  `--ink-500` #7A828A helper · `--ink-300` #BEC3CA disabled ·
  `--ink-200` #E3E5E8 hairlines.

### Brand
- `--brand-primary` #5CC25C, the single accent · `--brand-primary-hover`
  #48A848 · `--brand-primary-soft` #E8F6E8 for positive callouts.

### Data series
- Glucose range: `--range-in` #5CC25C · `--range-high` #F0B429 ·
  `--range-low` #FC5E5E · `--range-very-low` #C0392B · `--range-very-high`
  #E07B1F.
- `--graph-insulin` #E07B1F (orange) · `--graph-carb` #48A848 (green) ·
  `--graph-activity` #7654B8 (violet) · alert stretch `--accent-info-soft`
  (blue).

### Named Rules
- **COL-1 Tokens only.** No raw hex outside `src/styles/tokens.css`. The
  standalone HTML exports (`src/lib/report/clinicReportHtml.ts`) are exempt
  because they must inline their colours.
- **COL-2 One accent.** Brand green is the only accent, used sparingly.
  Glucose range colours appear only where they mean glucose.
- **COL-3 Green is a graphic, not text.** Brand green fails contrast as
  text on white; text uses ink, links use `--accent-info-ink`.
- **COL-4 Grey text passes 4.5:1.** `--ink-300` and `--ink-400` are never
  text colours. Small grey text uses `--ink-500` only at 15px and up;
  below that use `--ink-700`.
- **COL-5 Colour is never the only signal.** Pair it with a label, icon or
  position.
- **COL-6 Each series has one hue.** Insulin orange, carbs green, activity
  violet, alert stretch blue. Never reuse a series hue for another meaning on
  the same screen.

## Typography

Inter, weights 400, 500 and 600 only. The scale (Display 34/40, Title 22/28,
Body 15/22, Small 13/18, Label 11/14 uppercase +0.08em, Button 15/18) is in
`docs/visual-system.md` §2.

### Named Rules
- **TYPE-1 No 700+.** Weights stop at 600.
- **TYPE-2 Headings left-aligned**, except a centred onboarding slide.
- **TYPE-3 Numbers line up.** `font-variant-numeric: tabular-nums` wherever
  digits sit in columns or change in place.

## Layout

Each surface is designed for its own size; neither is a stretched or squeezed
copy of the other.

- **Phone app:** 440px max frame. Gutter `--space-5`, section gaps
  `--space-8`, card padding `--space-5`, rhythm `--space-4`.
- **Desktop app:** designed at 1280–1600 wide, usable down to a 1024×700
  window. A left sidebar for the views, a top bar for range, edit and share,
  and a 12-column dashboard grid with `--space-4` gutters. Detail opens
  beside the thing it explains (a side panel or popover), not in a bottom
  sheet. Glass applies to the toolbar, library panel, popovers and the one
  primary CTA; tiles and charts are solid (GLASS-1).
- Targets at least 44×44 on both, and everything that can be dragged or
  resized can also be moved from the keyboard.

### Named Rules
- **LAYOUT-1 Size-native.** Phone screens are designed at phone width and
  desktop screens at desktop width. Don't ship a phone layout centred in a
  desktop window, or a desktop grid squeezed onto a phone.
- **LAYOUT-2 The dashboard is the person's.** On desktop the person arranges
  their tiles (reorder, resize, add, remove, presets) and the layout persists.
  The two non-negotiable tiles (PROD-2) can move and resize but not leave.
- **LAYOUT-3 The review is fixed.** The care-team review has one layout and one
  order for every patient (PROD-1, VIS-10).
- **LAYOUT-4 Tile anatomy.** A desktop tile is a 44px header (title, at most one
  control, Details), a body that leads with one figure or chart and one caption,
  and at most one line of action below. A tile never hides content by cutting it:
  its minimum size fits its glance, it shows fewer items with "Show more" when
  short, and anything left scrolls inside the body. Sample data is marked once,
  in the top bar, not on each tile.
- **LAYOUT-5 One in-tile choice control.** Sort, range and mode choices in a tile
  use `TileSelect` (a pill that opens a menu). Menus draw in a layer above the
  page so no tile or panel clips them. Native selects and segmented controls
  stay out of tile headers; a weekday picker uses Sun, Mon, Tue, never letters.
- **LAYOUT-6 One primary per screen.** Each screen has one green action. Per-row
  actions are quiet, and a choice that isn't available says why in words rather
  than showing a greyed-out button.

## Components

The component catalog is the code in `src/components/` and
`src/screens/*/`. The registry (`src/data/system-registry.json`) records
which are production and where each is documented. Reuse or extend before
adding; `search_system` and `get_component` find the nearest one.

## Glass

Loop green, mixed with glass, for a few chosen surfaces and the primary
calls to action. Subtle but polished: a light green tint, a soft blur of what
sits behind, and one hairline highlight along the top edge. Tokens:
`--glass-green-fill`, `--glass-green-fill-strong`, `--glass-green-border`,
`--glass-highlight`, `--glass-neutral-fill`, `--glass-neutral-border`,
`--glass-blur`, `--glass-saturate`, `--glass-shadow`, `--glass-solid`.

Recipe: `background: var(--glass-highlight), var(--glass-green-fill);
backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
-webkit-backdrop-filter: …same…; border: 1px solid var(--glass-green-border);
box-shadow: var(--glass-shadow);`.

### Named Rules
- **GLASS-1 Glass is the control layer; data sits on solid ground.** Glass
  goes on the primary CTA, the floating capture button, the bottom navigation
  bar, sheets and popovers over content, and chart controls: the scrubber's
  readout pill, the range and time-of-day switches, legend chips. Never the
  data itself (marks, bands, axes, chart panels), the clinician TLDR or
  body-text cards. This follows Apple's Liquid Glass guidance: glass for
  navigation and controls, content underneath.
- **GLASS-1a Warnings stay neutral.** A "runs low" heads-up uses neutral
  glass, not green: green reads as in range.
- **GLASS-1b No glass on glass.** A control inside a glass sheet goes solid;
  the capture button floats above the glass tab bar, not on it.
- **GLASS-1c The app icon is not glass.** White tile, layered art; iOS makes
  the clear and tinted variants.
- **GLASS-2 Subtle.** Green tint at most 22% opacity (`-strong`), blur
  16–24px, one 1px top highlight, shadow no heavier than `--glass-shadow`. No
  coloured glows, no rainbow edges, no stacked glass on glass.
- **GLASS-3 Text on glass is `--ink-900`** and must pass 4.5:1 against the
  lightest thing that can sit behind it. White text never goes on green glass.
  Inactive tab labels may be #5F676F (about 6:1). Focus rings on glass are
  `--glass-focus-ring`, 2px.
- **GLASS-4 It has to work without the glass.** Under Reduce Transparency, or
  where `backdrop-filter` isn't supported, green glass falls back to
  `--glass-solid` and neutral glass to `--glass-neutral-solid`, with the same
  border. The CTA rests at `--glass-green-fill-strong` and presses at
  `--glass-green-fill-pressed`. Nothing may depend on the blur to be
  legible.
- **GLASS-5 One glass CTA per screen**, in line with one primary CTA per
  screen. Secondary actions stay quiet (ink outline or text).
- **GLASS-6 Glass is the one gradient exception besides the mark.** Only the
  `--glass-highlight` sheen; no other gradients on cards, buttons or icons.

This supersedes `docs/visual-system.md` §5 and §9's "primary CTA is ink-900
fill": the primary CTA is now a pill in Loop-green glass with `--ink-900`
text. Secondary buttons are unchanged.

## Data visuals

These rules apply to every chart in both surfaces. They come from the
research and the 4.5-star reference review in
`docs/desktop/comparison-references.md`.

### Named Rules
- **VIS-1 One locked scale.** Never rescale between the two things being
  compared, or between periods.
- **VIS-2 No dual axes.** Glucose and insulin sit in separate stacked panels
  on one shared time axis (the WeekdayHours grammar).
- **VIS-3 Show the sample before the verdict.** "13 of 14 days usable" on
  each side. Below the minimum, say "not enough yet", not a number.
- **VIS-4 Missing is drawn as missing.** Gaps are hatched or empty, never
  counted, and labelled by cause when known (pod connection lost, sensor
  warm-up, app expired).
- **VIS-5 Colour is never the only signal** (COL-5).
- **VIS-6 A plain verdict, honestly hedged.** "After the change, lunch peaks
  were lower", never "the change fixed it". Observations, never instructions
  (SAFE-1).
- **VIS-7 Mark the confounders** on the timeline: exercise, illness, pod or
  site change, missed meals, a different weekday mix.
- **VIS-8 The raw data is one tap away.** Smoothing never hides why a number
  changed ("See the hours", "See the days").
- **VIS-9 Glance and detail.** Every tracker has a glance face (one number or
  sentence plus a tiny version of the picture) and a detail face one tap in.
- **VIS-10 Clinician page one is glucose only**, in the AGP layout and
  order clinicians know: enough data, then lows, then time in range, then the
  curve. Insulin goes on page two as plain statements.

### What Loop did vs the settings
- **VIS-A1** Scheduled basal is the reference (a dotted step line or band);
  delivered insulin is the solid mark.
- **VIS-A2** Hour states with a tolerance: about as scheduled, more, less,
  suspended, no data.
- **VIS-A3** Clinicians' terms: algorithm-modulated vs user-initiated insulin,
  time in automation. No bolus/basal ratio (DATA-1).

### Before and after a settings change
- **VIS-B1** Anchor on the change date; compare N days before with N days
  after, matching the weekday mix; leave the change day out.
- **VIS-B2** Scope to the part of the day the change targeted, with the rest
  of the day available.
- **VIS-B3** Show who proposed, who agreed, and the next review date.

## Diabetes-native cues

What makes a screen read as built by and for people who loop, not as a
generic health dashboard. Use the cues people already read every day in
Loop, their CGM app and their pump.

### Named Rules
- **DM-1 Glucose speaks CGM.** The current value is the biggest number, with
  its unit (mg/dL or mmol/L), a trend arrow (↑↑ ↑ ↗ → ↘ ↓ ↓↓) and its age
  ("2 min ago"). A reading older than 15 minutes greys out and says so.
- **DM-2 The target band is always drawn.** Every glucose chart shades the
  person's own correction or target range (default 70–180) behind the line,
  as Loop and Dexcom do. Lows and highs take the range colours.
- **DM-3 Loop's status ring.** Loop freshness shows as Loop's own ring:
  green when it looped in the last 5 minutes, yellow at 5–15, red after 15,
  with the minutes beside it.
- **DM-4 Loop's stack.** Glucose, active insulin, active carbs and insulin
  delivery share one time axis, in that order, with the prediction as a
  dashed continuation of the glucose line where it's shown.
- **DM-5 Treatments are markers on the timeline.** Carbs (grams, with an
  absorption-time tail), boluses (units, user-initiated) and overrides or
  presets (a banner across their duration, named as in Loop: "Running",
  "Pre-Meal") sit on the time axis, not in a separate list.
- **DM-6 Device life is visible.** Pod age ("Pod 2d 14h"), sensor day
  ("Sensor day 7 of 10") and app build expiry ("Build expires in 62 days"),
  quiet until they matter.
- **DM-7 Numbers carry units, always.** U, U/hr, g, mg/dL, %, never a bare
  number. Insulin to two decimals only where Loop shows two.
- **DM-8 Night is real.** Overnight (12–6am) is a named slice in every
  time-of-day switch, and the app reads well in dark mode at 3am.
- **DM-9 Community words, not clinic jargon, on the patient side.** "In
  range", "looping", "pod change", "sensor warm-up", "override", "pre-bolus".
  Clinician terms (time in automation, algorithm-modulated insulin) on the
  care-team side.

## Elevation and shape

Cards: hairline 1px `--ink-200` border plus at most
`0 2px 12px rgba(0,0,0,0.04)`. Radius at least 10px on interactive surfaces.

## Do's and Don'ts

### Do:
- Lead with the simple read; put the detail one tap away.
- Use Loop's own vocabulary (Overrides, Presets, Correction Range, Carb Ratio,
  ISF, Glucose Safety Limit) and Loop's stacked chart grammar.
- Draw every state: empty, not enough data yet, loading, error, long content.

### Don't:
- Gradient fills (the brand mark and the glass sheen are the only exceptions,
  GLASS-6), glass on data panels (GLASS-1), white text on glass, emoji as icons,
  left-border accent cards, more than one primary CTA per screen.
- Drop shadows heavier than the card spec, radii under 10px on interactive
  surfaces, system blue for links.
