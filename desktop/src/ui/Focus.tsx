// The pieces every focused (expanded) tile view shares: one day picker, a Chart/Table switch and
// CSV download. The period itself is the app's one period (top bar); these only slice within it.
import { Segmented } from './kit';

/** Days within the period: every day, weekdays, weekends, or one weekday. Indexes match DAY_BY_WEEKDAY. */
export const DAY_PICKS = [
  { value: 'all', label: 'Every day', index: 7 },
  { value: 'wkd', label: 'Weekdays', index: 8 },
  { value: 'wke', label: 'Weekends', index: 9 },
  { value: 'sun', label: 'Sun', index: 0 },
  { value: 'mon', label: 'Mon', index: 1 },
  { value: 'tue', label: 'Tue', index: 2 },
  { value: 'wed', label: 'Wed', index: 3 },
  { value: 'thu', label: 'Thu', index: 4 },
  { value: 'fri', label: 'Fri', index: 5 },
  { value: 'sat', label: 'Sat', index: 6 },
] as const;
export type DayPick = (typeof DAY_PICKS)[number]['value'];
export const dayPickIndex = (v: DayPick) => DAY_PICKS.find((d) => d.value === v)!.index;
export const dayPickOf = (weekday: number): DayPick => DAY_PICKS.find((d) => d.index === weekday)?.value ?? 'all';
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayPickName = (v: DayPick) => (v === 'all' ? 'every day' : v === 'wkd' ? 'weekdays' : v === 'wke' ? 'weekends' : `${LONG[dayPickIndex(v)]}s`);

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The weekday (0–6) of a day label such as "Fri 30" or "Fri, Oct 30"; -1 if it can't tell. */
export const weekdayOfLabel = (label: string) => SHORT.indexOf(label.slice(0, 3));
/** Whether a day (by its label) falls in the pick. */
export function inPick(label: string, v: DayPick): boolean {
  if (v === 'all') return true;
  const w = weekdayOfLabel(label);
  if (w < 0) return false;
  if (v === 'wkd') return w >= 1 && w <= 5;
  if (v === 'wke') return w === 0 || w === 6;
  return w === dayPickIndex(v);
}

export function DayPicker({ value, onChange, compact = false }: { value: DayPick; onChange: (v: DayPick) => void; compact?: boolean }) {
  // The compact (tile) version keeps one row: every day plus the seven weekdays.
  const items = compact ? DAY_PICKS.filter((d) => d.value !== 'wkd' && d.value !== 'wke') : DAY_PICKS;
  return <Segmented size="sm" label="Days" items={items.map((d) => ({ value: d.value, label: compact && d.value === 'all' ? 'All' : d.label }))} value={value} onChange={onChange} />;
}

export type FocusView = 'chart' | 'table';

/** A CSV file from rows; values are quoted when they need it. */
export function downloadCsv(name: string, header: readonly string[], rows: readonly (readonly (string | number | null)[])[]) {
  const cell = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The bar above a focused view: what it covers, the day picker, Chart or Table, and CSV. */
export function FocusBar({ covers, day, onDay, view, onView, onCsv }: {
  covers: string; day?: DayPick; onDay?: (v: DayPick) => void; view: FocusView; onView: (v: FocusView) => void; onCsv: () => void;
}) {
  return (
    <div className="focus-bar">
      <span className="caption">{covers}</span>
      <div className="row wrap focus-bar-controls">
        {day && onDay && <DayPicker value={day} onChange={onDay} />}
        <Segmented size="sm" label="Show as" items={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} value={view} onChange={onView} />
        <button type="button" className="quiet-btn" onClick={onCsv}>Download CSV</button>
      </div>
    </div>
  );
}
