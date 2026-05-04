// Exponential decay factors for CTL (τ=42 days) and ATL (τ=7 days)
const CTL_FACTOR = 1 - Math.exp(-1 / 42);
const ATL_FACTOR = 1 - Math.exp(-1 / 7);

export interface TrainingLoadPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  daily_load: number;
}

export interface TrainingLoadResult {
  current: {
    ctl: number;
    atl: number;
    tsb: number;
    acwr: number;
    form_label: string;
  };
  series: TrainingLoadPoint[];
}

function formLabel(tsb: number, acwr: number): string {
  if (acwr > 1.5) return "injury risk";
  if (tsb > 10) return "peak form";
  if (tsb >= 0) return "fresh";
  if (tsb >= -10) return "neutral";
  if (tsb >= -30) return "tired";
  return "overreached";
}

/**
 * Computes CTL/ATL/TSB from raw activity records using proper EMA.
 *
 * @param activities  Raw rows with start_date, suffer_score, moving_time_seconds
 * @param returnDays  How many trailing days to include in the returned series
 */
export function computeTrainingLoad(
  activities: Array<{
    start_date: string;
    suffer_score: number | null;
    moving_time_seconds: number;
  }>,
  returnDays: number
): TrainingLoadResult {
  if (activities.length === 0) {
    return {
      current: { ctl: 0, atl: 0, tsb: 0, acwr: 0, form_label: "no data" },
      series: [],
    };
  }

  // Aggregate load per calendar day (sum in case of multiple activities)
  const loadByDate = new Map<string, number>();
  for (const act of activities) {
    const date = act.start_date.slice(0, 10); // YYYY-MM-DD
    const load = act.suffer_score ?? Math.round(act.moving_time_seconds / 60);
    loadByDate.set(date, (loadByDate.get(date) ?? 0) + load);
  }

  // Walk every calendar day from the earliest activity to today
  const today = new Date().toISOString().slice(0, 10);
  const sortedDates = [...loadByDate.keys()].sort();
  const startDate = sortedDates[0];

  let ctl = 0;
  let atl = 0;
  const allPoints: TrainingLoadPoint[] = [];

  const cursor = new Date(startDate);
  const end = new Date(today);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const load = loadByDate.get(date) ?? 0;
    ctl = ctl + (load - ctl) * CTL_FACTOR;
    atl = atl + (load - atl) * ATL_FACTOR;
    allPoints.push({
      date,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      daily_load: load,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const last = allPoints[allPoints.length - 1];
  const acwr = last.ctl > 0 ? Math.round((last.atl / last.ctl) * 100) / 100 : 0;

  return {
    current: {
      ctl: last.ctl,
      atl: last.atl,
      tsb: last.tsb,
      acwr,
      form_label: formLabel(last.tsb, acwr),
    },
    series: allPoints.slice(-Math.min(returnDays, allPoints.length)),
  };
}
