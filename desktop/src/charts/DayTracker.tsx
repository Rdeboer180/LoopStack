// The day tracker (PROD-2): glucose, active insulin, active carbs and exercise
// for each hour of one weekday, stacked on one shared hour axis (VIS-2, DM-4).
// The heads-up stretch is shaded. Glucose below your low is a larger red dot and
// named in the label, so colour is never the only signal (COL-5).
import { DATA, DAY, type Dataset } from '../data/current';
import { hourName, hourTick, rangeLabel } from '../data/derive';
import { BANDS } from '../data/ranges';

const PAD = { L: 92, R: 34, T: 22, B: 20 };

export function DayTrackerChart({ day = DAY, W, H, now, compact = false }: { day?: Dataset['DAY']; W: number; H: number; now?: number | null; compact?: boolean }) {
  // "Now" on the synthetic Friday is the boards' 1:05pm; on real data it's the clock, only on today's weekday.
  if (now === undefined) {
    const d = new Date();
    now = DATA.source === 'synthetic' ? 13 + 5 / 60 : d.getDay() === day.weekday ? d.getHours() + d.getMinutes() / 60 : null;
  }
  const pw = W - PAD.L - PAD.R;
  const ph = H - PAD.T - PAD.B;
  const col = pw / 24;
  const x = (h: number) => PAD.L + (h + 0.5) * col;
  const xt = (t: number) => PAD.L + t * col;
  // Panels: glucose gets half, the other three share the rest.
  const gap = compact ? 6 : 10;
  const gH = ph * 0.5;
  const sub = (ph - gH - gap * 3) / 3;
  const top = [PAD.T, PAD.T + gH + gap, PAD.T + gH + gap * 2 + sub, PAD.T + gH + gap * 3 + sub * 2];
  const gy = (g: number) => top[0] + ((260 - Math.min(260, Math.max(40, g))) / 220) * gH;
  const peakAt = (vals: readonly number[]) => vals.reduce((b, v, h) => (v > vals[b] ? h : b), 0);
  const iobPeak = peakAt(day.iob);
  const iobMax = Math.max(3.2, day.iob[iobPeak] * 1.08);
  const cobMax = Math.max(64, Math.max(...day.cob) * 1.08);
  const exEntries = Object.entries(day.exercise).map(([h, m]) => [Number(h), m] as const);
  const exMax = Math.max(45, ...exEntries.map(([, m]) => m));
  const exTop = exEntries.reduce<readonly [number, number] | null>((b, e) => (!b || e[1] > b[1] ? e : b), null);
  const st = day.stretch;
  const lows = day.glucose.map((g, h) => [g, h] as const).filter(([g]) => g < BANDS.low);
  const area = (vals: readonly number[], base: number, scale: number) =>
    `M${x(0)} ${base}${vals.map((v, h) => `L${x(h).toFixed(1)} ${(base - Math.max(0, v) * scale).toFixed(1)}`).join('')}L${x(23)} ${base}Z`;
  const line = (vals: readonly number[], base: number, scale: number) =>
    `M${vals.map((v, h) => `${x(h).toFixed(1)} ${(base - Math.max(0, v) * scale).toFixed(1)}`).join('L')}`;
  const cobPeak = peakAt(day.cob);
  const label = [
    `Day tracker, the average ${day.name} over the last ${day.weeks} weeks, by hour.`,
    lows.length ? `Glucose dips below ${BANDS.low} mg/dL at ${lows.map(([g, h]) => `${hourName(h)}, ${g}`).join(' and ')} mg/dL${st ? `, inside the shaded ${rangeLabel(st[0], st[1])} stretch` : ''}.` : `Glucose stays at or above ${BANDS.low} mg/dL in every hour.`,
    `Active insulin peaks at ${day.iob[iobPeak].toFixed(1)} U around ${hourName(iobPeak)}.`,
    exTop ? `The most exercise is at ${hourName(exTop[0])}, ${Math.round(exTop[1])} minutes.` : 'No exercise recorded.',
    `Active carbs peak at ${Math.round(day.cob[cobPeak])} g around ${hourName(cobPeak)}.`,
  ].join(' ');
  const labelStyle = { fill: 'var(--ink-700)' };
  const rows: [string, number, number][] = [
    ['Glucose', top[0], gH],
    ['Active insulin', top[1], sub],
    ['Active carbs', top[2], sub],
    ['Exercise', top[3], sub],
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      {st && <rect x={xt(st[0])} y={PAD.T - 4} width={(st[1] - st[0]) * col} height={ph + 4} style={{ fill: 'var(--accent-info-soft)' }} />}
      {st && <text x={xt((st[0] + st[1]) / 2)} y={PAD.T - 8} fontSize="11" fontWeight="600" textAnchor="middle" style={{ fill: 'var(--accent-info-ink)' }}>{rangeLabel(st[0], st[1])}</text>}
      {/* target band, always drawn (DM-2) */}
      <rect x={PAD.L} y={gy(BANDS.high)} width={pw} height={gy(BANDS.low) - gy(BANDS.high)} style={{ fill: 'var(--range-in-soft)' }} />
      {[BANDS.low, BANDS.high].map((v) => (
        <g key={v}>
          <line x1={PAD.L} x2={PAD.L + pw} y1={gy(v)} y2={gy(v)} style={{ stroke: 'var(--range-in)' }} strokeWidth="1" opacity="0.6" />
          <text x={W - PAD.R + 6} y={gy(v) + 4} fontSize="11" style={labelStyle}>{v}</text>
        </g>
      ))}
      <path d={`M${day.glucose.map((g, h) => `${x(h).toFixed(1)} ${gy(g).toFixed(1)}`).join('L')}`} fill="none" style={{ stroke: 'var(--ink-500)' }} strokeWidth="1.5" strokeLinejoin="round" />
      {day.glucose.map((g, h) => (
        g < BANDS.low
          ? <circle key={h} cx={x(h)} cy={gy(g)} r="4.5" style={{ fill: 'var(--range-low)', stroke: 'var(--surface-0)' }} strokeWidth="1.2" />
          : <circle key={h} cx={x(h)} cy={gy(g)} r="2.6" style={{ fill: g > BANDS.high ? 'var(--range-high)' : 'var(--range-in)' }} />
      ))}
      {lows.length > 0 && !compact && (
        <text x={x(lows[0][1]) + 8} y={gy(lows[0][0]) + 16} fontSize="11" fontWeight="600" style={{ fill: 'var(--ink-900)' }}>low {Math.min(...lows.map(([g]) => g))}</text>
      )}
      {/* active insulin */}
      <line x1={PAD.L} x2={PAD.L + pw} y1={top[1] + sub} y2={top[1] + sub} style={{ stroke: 'var(--ink-200)' }} />
      <path d={area(day.iob, top[1] + sub, sub / iobMax)} style={{ fill: 'var(--graph-insulin-soft)' }} />
      <path d={line(day.iob, top[1] + sub, sub / iobMax)} fill="none" style={{ stroke: 'var(--graph-insulin)' }} strokeWidth="1.5" strokeLinejoin="round" />
      <text x={W - PAD.R + 6} y={top[1] + 10} fontSize="11" style={labelStyle}>{Math.round(iobMax)} U</text>
      {/* active carbs */}
      <line x1={PAD.L} x2={PAD.L + pw} y1={top[2] + sub} y2={top[2] + sub} style={{ stroke: 'var(--ink-200)' }} />
      <path d={area(day.cob, top[2] + sub, sub / cobMax)} style={{ fill: 'var(--graph-carb-soft)' }} />
      <path d={line(day.cob, top[2] + sub, sub / cobMax)} fill="none" style={{ stroke: 'var(--graph-carb)' }} strokeWidth="1.5" strokeLinejoin="round" />
      <text x={W - PAD.R + 6} y={top[2] + 10} fontSize="11" style={labelStyle}>{Math.round(cobMax / 10) * 10} g</text>
      {/* exercise minutes */}
      <line x1={PAD.L} x2={PAD.L + pw} y1={top[3] + sub} y2={top[3] + sub} style={{ stroke: 'var(--ink-200)' }} />
      {exEntries.map(([h, m]) => {
        const hh = (m / exMax) * sub;
        return <rect key={h} x={x(h) - col * 0.35} y={top[3] + sub - hh} width={col * 0.7} height={hh} rx="1.5" style={{ fill: 'var(--graph-activity)' }} opacity={m >= 30 ? 1 : 0.5} />;
      })}
      {!compact && exTop && exTop[1] >= 20 && <text x={x(exTop[0]) + col * 0.5} y={top[3] + Math.min(12, sub)} fontSize="11" style={labelStyle}>{DATA.source === 'synthetic' ? 'run' : 'exercise'} {Math.round(exTop[1])} min</text>}
      <text x={W - PAD.R + 6} y={top[3] + 10} fontSize="11" style={labelStyle}>{Math.round(exMax)} m</text>
      {rows.map(([t, y, hh]) => (
        <text key={t} x="0" y={y + Math.min(hh / 2 + 4, 14)} fontSize="11" fontWeight="500" style={labelStyle}>{t}</text>
      ))}
      {now != null && (
        <g>
          <line x1={xt(now)} x2={xt(now)} y1={PAD.T - 2} y2={PAD.T + ph} style={{ stroke: 'var(--ink-700)' }} strokeDasharray="2 2" />
          <text x={xt(now) - 4} y={PAD.T - 8} fontSize="11" textAnchor="end" style={labelStyle}>Now</text>
        </g>
      )}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <text key={h} x={xt(h)} y={H - 4} fontSize="11" textAnchor="middle" style={labelStyle}>{hourTick(h)}</text>
      ))}
    </svg>
  );
}
