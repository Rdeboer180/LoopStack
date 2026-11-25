// A change against the equal-length period before, in words: "↑4 pts vs the 14 days before".
// Arrow, amount and comparison are all printed, so colour is never the only cue (COL-5),
// and it says what changed, never whether to act on it (SAFE-1).
import { PERIOD, READ } from '../data/current';

export function deltaText(now: number, prev: number, unit: string, digits = 0): { arrow: string; amount: string } | null {
  const d = now - prev;
  const r = Number(Math.abs(d).toFixed(digits));
  if (r === 0) return { arrow: '→', amount: 'same' };
  return { arrow: d > 0 ? '↑' : '↓', amount: `${r.toFixed(digits)}${unit}` };
}

export function DeltaChip({ now, prev, unit, digits = 0 }: { now: number | null | undefined; prev: number | null | undefined; unit: string; digits?: number }) {
  if (now == null || prev == null || !Number.isFinite(now) || !Number.isFinite(prev) || READ.prev == null) return null;
  const t = deltaText(now, prev, unit, digits)!;
  const against = `the ${PERIOD.days} days before`;
  return (
    <span className="delta-chip" aria-label={t.amount === 'same' ? `The same as ${against}` : `${t.arrow === '↑' ? 'Up' : 'Down'} ${t.amount} against ${against}`}>
      <span aria-hidden="true">{t.arrow} {t.amount}</span>
      <span className="caption" aria-hidden="true">vs {against}</span>
    </span>
  );
}
