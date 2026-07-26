const DAY_MS = 24 * 60 * 60 * 1_000;

export type CountdownProgress = {
  daysRemaining: number;
  totalDays: number;
  fillPercent: number;
  expired: boolean;
};

function startOfLocalDay(value: string | number | Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Measures the remaining fill against the countdown's original creation date.
 * Editing the title or target intentionally preserves that original baseline.
 */
export function calculateCountdownProgress(
  targetAt: string,
  createdAt: string | undefined,
  now = new Date(),
): CountdownProgress {
  const target = startOfLocalDay(targetAt).getTime();
  const current = now.getTime();
  const remaining = target - current;
  const expired = remaining <= 0;
  const daysRemaining = expired ? 0 : Math.max(0, Math.ceil(remaining / DAY_MS));
  const started = createdAt
    ? startOfLocalDay(createdAt)
    : startOfLocalDay(target - 30 * DAY_MS);
  const totalDays = Math.max(1, Math.round((target - started.getTime()) / DAY_MS));
  const fillPercent = expired
    ? 0
    : Math.max(0, Math.min(100, Math.round((daysRemaining / totalDays) * 100)));

  return { daysRemaining, totalDays, fillPercent, expired };
}
