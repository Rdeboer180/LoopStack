// Notifications on this Mac: the phone's alert engine (alertEngine.ts) on the
// data the desktop holds, with the phone's preferences store (same fields and
// key). The phone hands its queue to iOS; here the queue fires while LoopStack
// is open, through macOS notifications. Heads-ups and readings only, never a
// dose or an instruction (SAFE-1).
import { buildAlerts, type AlertCategory, type PendingAlert } from '@/lib/alerts/alertEngine';
import { activeCategories, loadNotificationPrefs, type NotificationPrefs } from '@/data/notificationPrefs';
import { CGM_NOW, DATA } from './current';

/** What the Mac can work out today. The rest needs engines the desktop doesn't run yet; they stay on the phone. */
export const MAC_CATEGORIES: ReadonlySet<AlertCategory> = new Set<AlertCategory>(['trend_heads_up', 'day_report', 'data_health']);

export function macQueue(prefs: NotificationPrefs = loadNotificationPrefs(), now = new Date()): PendingAlert[] {
  const live = activeCategories(prefs);
  for (const k of Object.keys(live) as AlertCategory[]) if (!MAC_CATEGORIES.has(k)) live[k] = false;
  const latest = CGM_NOW.mgdl == null ? null : new Date(now.getTime() - CGM_NOW.ageMin * 60_000).toISOString();
  return buildAlerts({
    riskWindows: [],
    newlyReadable: [],
    basal: null,
    autosens: null,
    autotune: null,
    latestGlucoseIso: DATA.source === 'synthetic' ? now.toISOString() : latest,
    enabled: live,
    now,
    dayHourGrid: DATA.WEEKDAY_GRID,
    reportAt: prefs.reportAt,
  }).sort((a, b) => a.fireAtIso.localeCompare(b.fireAtIso));
}

export type MacPermission = 'granted' | 'denied' | 'default' | 'unavailable';
export const macPermission = (): MacPermission => (typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);
export async function askMac(): Promise<MacPermission> {
  if (typeof Notification === 'undefined') return 'unavailable';
  return Notification.requestPermission();
}

export function showOnMac(title: string, body: string): boolean {
  if (macPermission() !== 'granted') return false;
  try { new Notification(title, { body, silent: false }); return true; } catch { return false; }
}

// One timer per queued alert, rebuilt whenever the preferences or the data change.
let timers: number[] = [];
const MAX_DELAY = 2_147_000_000; // setTimeout's ceiling, about 24 days

export function scheduleOnMac(prefs: NotificationPrefs = loadNotificationPrefs()): number {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
  if (!prefs.enabled || macPermission() !== 'granted') return 0;
  const now = Date.now();
  for (const a of macQueue(prefs)) {
    const wait = Date.parse(a.fireAtIso) - now;
    if (wait <= 0 || wait > MAX_DELAY) continue;
    timers.push(window.setTimeout(() => showOnMac(a.title, a.body), wait));
  }
  return timers.length;
}
