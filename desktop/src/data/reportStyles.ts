// Care-team report styles: the same packet, laid out in the order and words a
// clinician already reads in. LoopStack's own layout is the default. The other
// styles follow the section order and terms of the reports clinicians know;
// they don't copy anyone's branding, and none is made by or affiliated with
// those companies (BRAND-2). The numbers are the same in every style.
import { useEffect, useState } from 'react';

export type BlockId = 'read' | 'stats' | 'agp' | 'tir' | 'tldr' | 'patterns' | 'daily' | 'insulin' | 'explorer' | 'therapy' | 'timeline' | 'compare' | 'beforeAfter' | 'trends' | 'notes';
export type StyleId = 'loopstack' | 'clarity' | 'glooko' | 'tandem' | 'carelink';

export interface Terms {
  tir: string; gmi: string; cv: string; mean: string; sensor: string; automation: string;
  algorithm: string; user: string; tdi: string;
  statsTitle: string; agpTitle: string; tirTitle: string; insulinTitle: string; compareTitle: string;
}

export const DEFAULT_TERMS: Terms = {
  tir: 'In range', gmi: 'GMI', cv: 'CV', mean: 'mean', sensor: 'Sensor worn', automation: 'Time in automation',
  algorithm: 'algorithm-modulated', user: 'user-initiated', tdi: 'total daily insulin, median',
  statsTitle: 'Glucose statistics', agpTitle: 'AGP · glucose by time of day', tirTitle: 'Time in ranges', insulinTitle: 'Insulin', compareTitle: 'This period against the one before',
};

export interface ReportSection { id: string; label: string; blocks: BlockId[] }
export interface ReportStyle {
  id: StyleId;
  /** In the dropdown. */
  label: string;
  /** One line under the dropdown: what it's modelled on, and that it isn't theirs. */
  note: string;
  sections: ReportSection[];
  terms: Terms;
  /** The read numbers its steps (LoopStack's AGP review order). */
  numbered: boolean;
}

// Two tabs every style ends on: how the period moved, and the person's own notes since the last visit.
const TRENDS: ReportSection = { id: 'trends', label: 'Trends', blocks: ['trends', 'compare'] };
/** For styles that already have a Compare section: the trend on its own. */
const TRENDS_ONLY: ReportSection = { id: 'trends', label: 'Trends', blocks: ['trends'] };
const NOTES: ReportSection = { id: 'notes', label: 'Notes', blocks: ['notes'] };

export const LOOPSTACK_STYLE: ReportStyle = {
  id: 'loopstack',
  label: 'LoopStack',
  note: 'LoopStack’s layout: the read in AGP order, what Loop did, then the settings timeline.',
  numbered: true,
  terms: DEFAULT_TERMS,
  sections: [
    { id: 'glucose', label: 'Visit TLDR', blocks: ['read', 'agp', 'tldr'] },
    { id: 'loop', label: 'What Loop did', blocks: ['insulin', 'explorer'] },
    { id: 'changes', label: 'Settings timeline', blocks: ['therapy', 'timeline', 'beforeAfter'] },
    TRENDS,
    NOTES,
  ],
};

// Section orders and generic metric names from each report's published clinic
// guide (researched 2026-11-15). Loop's own meanings are kept: automation is
// "closed loop" in every style, never another system's product term.
//
// Audit, Nov 24: a style borrows a report's order and words so a clinician finds
// things where they expect them. It never makes Loop look like that pump. So in
// every style: the settings section is "Loop settings" and leads with the values
// Loop doses against (therapy), and the first section ends on where the care
// team's input helps most (tldr). No block appears twice in one style.

/** Overview first: statistics, time in range, the profile, then ranked patterns. CGM-first, Loop after. */
const CLARITY: ReportStyle = {
  id: 'clarity',
  label: 'Clarity-style overview',
  note: 'Section order and metric names familiar from Dexcom Clarity’s clinic reports: Overview, Patterns, Daily, Compare. Not made by or affiliated with Dexcom.',
  numbered: false,
  terms: { ...DEFAULT_TERMS, tir: 'Time in Range', mean: 'Average Glucose', cv: 'Coefficient of Variation', sensor: 'Sensor Usage', automation: 'Time in closed loop', statsTitle: 'Overview', agpTitle: 'AGP · ambulatory glucose profile', tirTitle: 'Time in Range', compareTitle: 'Compare · this period and the one before' },
  sections: [
    { id: 'overview', label: 'Overview', blocks: ['stats', 'tir', 'agp', 'tldr'] },
    { id: 'patterns', label: 'Patterns', blocks: ['patterns', 'daily'] },
    { id: 'compare', label: 'Compare', blocks: ['compare', 'beforeAfter'] },
    { id: 'loop', label: 'Loop and settings', blocks: ['insulin', 'explorer', 'therapy', 'timeline'] },
    TRENDS_ONLY,
    NOTES,
  ],
};

/** Summary first: CGM information, insulin information and the mode split; Weekly and Daily only if the summary shows a problem. */
const GLOOKO: ReportStyle = {
  id: 'glooko',
  label: 'Glooko-style summary (Omnipod 5)',
  note: 'Section order familiar from Glooko’s summary for Omnipod 5: Summary, Weekly, Daily, Settings. Not made by or affiliated with Glooko or Insulet.',
  numbered: false,
  terms: { ...DEFAULT_TERMS, tir: 'Time in Range', mean: 'Average glucose', sensor: 'CGM active', automation: 'Time in closed loop', statsTitle: 'CGM information', insulinTitle: 'Insulin information · system details', tirTitle: 'Time in Range' },
  sections: [
    { id: 'summary', label: 'Summary', blocks: ['stats', 'tir', 'insulin', 'tldr'] },
    { id: 'weekly', label: 'Weekly', blocks: ['agp', 'patterns'] },
    { id: 'daily', label: 'Daily', blocks: ['daily', 'explorer'] },
    { id: 'settings', label: 'Loop settings', blocks: ['therapy', 'timeline', 'beforeAfter'] },
    TRENDS,
    NOTES,
  ],
};

/** Overview: CGM summary, time in range against the last period, closed-loop use, trends, then daily insulin. */
const TANDEM: ReportStyle = {
  id: 'tandem',
  label: 'Tandem Source-style overview',
  note: 'Section order familiar from Tandem Source’s clinic report: Overview, Daily Timeline, then settings, here Loop’s own. Not made by or affiliated with Tandem Diabetes Care.',
  numbered: false,
  terms: { ...DEFAULT_TERMS, tir: 'Time in target range', mean: 'Average CGM', sensor: 'CGM time of use', automation: 'Closed-loop usage', statsTitle: 'CGM summary', agpTitle: 'Glucose trends · median and spread', tirTitle: 'Time in target range', insulinTitle: 'Average daily insulin', compareTitle: 'Time in range comparison', tdi: 'average total daily insulin' },
  sections: [
    { id: 'overview', label: 'Overview', blocks: ['stats', 'compare', 'insulin', 'agp', 'tldr'] },
    { id: 'timeline', label: 'Daily timeline', blocks: ['daily', 'explorer'] },
    { id: 'settings', label: 'Loop settings', blocks: ['therapy', 'timeline', 'beforeAfter'] },
    TRENDS_ONLY,
    NOTES,
  ],
};

/** Assessment and progress: two periods side by side first, then patterns, time in range and the statistics block. */
const CARELINK: ReportStyle = {
  id: 'carelink',
  label: 'CareLink-style assessment',
  note: 'Section order familiar from Medtronic CareLink’s Assessment and Progress report: two periods compared first, then Weekly Review, then settings, here Loop’s own. Not made by or affiliated with Medtronic.',
  numbered: false,
  terms: { ...DEFAULT_TERMS, tir: 'Time in range', mean: 'Average SG', sensor: 'Sensor wear', automation: 'Closed loop (share of time)', statsTitle: 'Statistics', compareTitle: 'Assessment and progress · this period and the one before', tirTitle: 'Time in range', algorithm: 'automatic (basal and corrections)', user: 'user-entered boluses' },
  sections: [
    { id: 'assessment', label: 'Assessment and progress', blocks: ['compare', 'agp', 'patterns', 'tir', 'stats', 'insulin', 'tldr'] },
    { id: 'weekly', label: 'Weekly review', blocks: ['daily', 'explorer'] },
    { id: 'settings', label: 'Loop settings', blocks: ['therapy', 'timeline', 'beforeAfter'] },
    TRENDS_ONLY,
    NOTES,
  ],
};

export const REPORT_STYLES: ReportStyle[] = [LOOPSTACK_STYLE, CLARITY, GLOOKO, TANDEM, CARELINK];
export const styleById = (id: string | null | undefined) => REPORT_STYLES.find((s) => s.id === id) ?? LOOPSTACK_STYLE;

// The care team's preferred style, kept on this Mac.
const KEY = 'loopstack.reportStyle';
const subs = new Set<() => void>();
function read(): StyleId {
  try { return styleById(window.localStorage.getItem(KEY)).id; } catch { return 'loopstack'; }
}
export function useReportStyle(): [ReportStyle, (id: StyleId) => void] {
  const [id, setId] = useState<StyleId>(read);
  useEffect(() => { const f = () => setId(read()); subs.add(f); return () => { subs.delete(f); }; }, []);
  return [styleById(id), (next) => {
    try { window.localStorage.setItem(KEY, next); } catch { /* this session only */ }
    setId(next);
    subs.forEach((f) => f());
  }];
}
