// The AI connector's page side: what's sent (a summary the person can read
// first, PRODUCT.md SAFE-7) and the check every answer passes before it shows
// (SAFE-1, SAFE-3, SAFE-5, with the governance gate's own rules).
// @ts-expect-error plain ESM module without types
import { blocksChange, checkCopy, CODES } from '../../../scripts/system/core.mjs';
import { CHANGES, DATA, DAY, HEADS_UP, INSULIN, LOOP, LUNCH, MEALS, PERIOD, READ, SCHED, TEXT, USABLE_N } from './current';
import { count, hourName } from './derive';
import type { Commit, LoopBuildStatus } from './loopBuild';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface AiBridge {
  config: () => Promise<{ connected: boolean; model: string }>;
  connect: (input: { apiKey: string }) => Promise<Result<{ model: string }>>;
  disconnect: () => Promise<{ ok: true }>;
  ask: (input: { question: string; summary: unknown }) => Promise<Result<{ answer: string; model: string }>>;
  chat: (input: { messages: { role: 'user' | 'assistant'; text: string }[]; context: unknown }) => Promise<Result<{ answer: string; model: string }>>;
  draft: (input: { description: string }) => Promise<Result<{ id: string; title: string; summary: string; dosing: boolean; files: { path: string; isNew: boolean; added: number; removed: number }[]; patch: string }>>;
  commit: (input: { id: string; reviewed: boolean; confirmDosing: boolean }) => Promise<Result<{ commit: { sha: string; url: string } }>>;
}
export const aiBridge = (): AiBridge | null => window.loopstack?.ai ?? null;

/** The numbers the dashboard already shows, without names, addresses or raw readings. */
export function dataSummary() {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: hourName(h),
    scheduledUph: SCHED[h],
    deliveredMedianUph: LOOP[h],
    daysLess: count(h, 'l'),
    daysMore: count(h, 'm'),
    daysSuspended: count(h, 's'),
  }));
  return {
    source: DATA.source === 'synthetic' ? 'synthetic sample patient' : 'Nightscout',
    period: PERIOD.label,
    days: PERIOD.days,
    usableDays: USABLE_N,
    glucose: { ...READ },
    insulin: { ...INSULIN },
    whatLoopDid: { toleranceForAboutAsScheduled: '±15%', hours },
    headsUpToday: HEADS_UP ? { title: HEADS_UP.title, detail: HEADS_UP.detail } : null,
    dayTracker: { weekday: DAY.name, weeks: DAY.weeks, medianGlucoseByHour: DAY.glucose, activeInsulinByHour: DAY.iob, activeCarbsByHour: DAY.cob, exerciseMinutesByHour: DAY.exercise },
    settingsChanges: CHANGES.map((c) => ({ date: c.date, setting: c.setting, from: c.from, to: c.to, status: c.status })),
    lunchBeforeAfter: { comparing: LUNCH.change, before: LUNCH.before, after: LUNCH.after },
    meals: MEALS.groups.map((g) => ({ meal: g.name, times: g.n, medianCarbsG: g.medianCarbsG, medianRiseMgdl: g.medianRiseMgdl, medianPeakAfterMin: g.medianPeakAfterMin, medianEnteredAbsorptionMin: g.medianEnteredMin, medianObservedAbsorptionMin: g.medianObservedMin, medianMinutesBackNearStart: g.medianBackMin })),
    findings: { ...TEXT },
  };
}

/** What the chat sees of the person's Loop repo: no token, no workflow logs, commit titles only. */
export function repoSummary(build: LoopBuildStatus | null, commits: Commit[]) {
  if (!build) return null;
  const run = (r: LoopBuildStatus['lastBuild']) => r && { date: r.createdAt, status: r.status, conclusion: r.conclusion };
  return {
    repo: `${build.owner}/${build.repo}`,
    branch: build.branch,
    forkOf: build.parent,
    loopVersion: build.loopVersion,
    patches: build.patches,
    customizations: build.customizations,
    latestBuildRun: run(build.latestRun),
    lastSuccessfulBuild: run(build.lastBuild),
    testflightExpiresAt: build.testflightExpiresAt,
    recentCommits: commits.map((c) => ({ date: c.date, message: c.message.split(/\r?\n/, 1)[0] })),
  };
}

/** Findings that stop an answer from being shown, as plain reasons. */
export function heldBack(answer: string): string[] {
  const found = (checkCopy(answer) as { code: string }[]).filter((f) => blocksChange(f));
  const rules = CODES as Record<string, string>;
  return [...new Set(found.map((f) => rules[f.code] ?? f.code))];
}
