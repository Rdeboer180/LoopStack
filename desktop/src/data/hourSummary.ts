import { MIN_READINGS_PER_CELL_WEEK, MIN_WEEKS_PER_CELL } from '@/lib/metrics/dayHourGrid';
import type { Dataset } from './dataset';
import type { HourSelection } from '../nav';
import { rangeLabel } from './derive';

/** A selected hour can be discussed without exporting dates or individual readings. */
export function hourSummary(data: Dataset, selection: HourSelection) {
  const grid = data.WEEKDAY_GRID;
  const day = grid.days[selection.weekday];
  const cell = day.hours[selection.hour];
  const samples = cell.samples ?? [];
  return {
    source: data.source === 'synthetic' ? 'Sample profile' : 'Nightscout',
    weekday: day.label,
    localHour: rangeLabel(cell.hour, cell.hour + 1),
    lookbackWeeks: 12,
    minimumReadingsPerWeek: MIN_READINGS_PER_CELL_WEEK,
    minimumWeeks: MIN_WEEKS_PER_CELL,
    countedWeeks: cell.weeksVoted,
    partialWeeks: samples.length - cell.weeksVoted,
    countedReadings: samples.reduce((n, row) => n + (row.count >= MIN_READINGS_PER_CELL_WEEK ? row.count : 0), 0),
    rangeMgdl: [grid.targetLowMgdl, grid.targetHighMgdl],
    medianOfWeeklyMediansMgdl: cell.medianMgdl,
    readingsBelowPct: cell.lowPct,
    readingsAbovePct: cell.highPct,
  };
}
