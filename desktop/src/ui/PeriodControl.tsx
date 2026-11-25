// The one review period for the whole app (LAYOUT-7): 14, 30, 90 or 180 days. Every tile follows it;
// a tile that can't (Glucose now, the 12-week heads-ups) names its own window in words.
// A calm pill in the top bar: the period and its dates; the choices open in a menu.
import { useState } from 'react';
import { PERIOD, USABLE_N } from '../data/current';
import { PERIODS, setPeriod, type PeriodDays } from '../data/source';
import { IChevronDown, Menu, useAnnounce } from './kit';

export function PeriodControl() {
  const announce = useAnnounce();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (days: PeriodDays) => {
    if (days === PERIOD.days || busy) return;
    setBusy(days); setError(null);
    announce(`Loading the last ${days} days.`);
    try { await setPeriod(days); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load that period.'); setBusy(null); }
  };
  const usable = `${USABLE_N} of ${PERIOD.days} days usable`;
  return (
    <div className="period-control" title={busy ? undefined : `${PERIOD.label} · ${usable} · every tile follows this period`}>
      <Menu
        label={busy ? `Loading the last ${busy} days` : `Period for every tile: last ${PERIOD.days} days, ${PERIOD.label}, ${usable}. Change period`}
        buttonClass="period-pill"
        items={PERIODS.map((d) => ({ label: `Last ${d} days`, hint: d === PERIOD.days ? PERIOD.label : d === 14 ? 'Standard report' : undefined, checked: d === (busy ?? PERIOD.days), onSelect: () => { void pick(d); } }))}
      >
        {busy ? <span>Loading {busy} days…</span> : <>
          <span><span className="period-prefix">Last </span>{PERIOD.days} days</span>
          <span className="period-dates">{PERIOD.label}</span>
        </>}
        <IChevronDown />
      </Menu>
      {error && <span className="caption error" role="alert">{error}</span>}
    </div>
  );
}
