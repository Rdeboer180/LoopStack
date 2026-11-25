// Plain sentences the Glance puts over its marks, shared by phone and Mac so
// both say the same thing. Observations only (SAFE-1).

/** Over the day rings: the day that stands out, or that none does. Today is left out (it's partial). */
export function weekNote(days: readonly { name: string; pct: number | null; today: boolean }[]): string {
  const counted = days.filter((d) => !d.today && d.pct != null) as { name: string; pct: number }[];
  if (!counted.length) return 'No full days counted yet';
  const lo = counted.reduce((a, d) => (d.pct < a.pct ? d : a));
  const hi = Math.max(...counted.map((d) => d.pct));
  if (hi - lo.pct < 5) return `Steady: ${lo.pct}% or more every day`;
  return `Lowest ${lo.name}, ${lo.pct}%`;
}

/** Splits per-day percents into up to `n` stretches, oldest first: each the mean of its counted days, null when none. */
export function stretches(values: readonly (number | null)[], n = 12): (number | null)[] {
  if (values.length < 2) return [];
  const k = Math.min(n, values.length);
  return Array.from({ length: k }, (_, i) => {
    const part = values.slice(Math.floor((i * values.length) / k), Math.floor(((i + 1) * values.length) / k)).filter((v): v is number => v != null);
    return part.length ? Math.round((part.reduce((a, b) => a + b, 0) / part.length) * 10) / 10 : null;
  });
}

/** How time below moved: the first third of the stretches against the last third. */
export function lowTrendNote(trend: readonly (number | null)[]): string | undefined {
  const third = Math.max(1, Math.floor(trend.length / 3));
  const avg = (xs: readonly (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const a = avg(trend.slice(0, third)), b = avg(trend.slice(-third));
  if (a == null || b == null || trend.length < 3) return undefined;
  if (Math.abs(b - a) < 0.5) return 'About the same across the period';
  return `${b < a ? 'Down' : 'Up'} from ${(Math.round(a * 10) / 10).toFixed(1)}% early in the period`;
}
