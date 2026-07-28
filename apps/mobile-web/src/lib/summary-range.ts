import type { Category, MonthlyReport, Transaction } from "@spending-tracker/shared";
import type { SummaryRangeMode } from "../state/summary-range";

type SummaryRangeInput = {
  mode: SummaryRangeMode;
  customFrom: string;
  customTo: string;
  smartPaydays: string;
  cycleOffset?: number;
};

export const MAX_CUSTOM_RANGE_DAYS = 366;
const MAX_BUDGET_MONTHS = 13;

export type ResolvedSummaryRange = {
  key: string;
  title: string;
  subtitle?: string;
  from?: string;
  to?: string;
  forecastTo?: string;
  error?: string;
};

export function budgetMonthsForRange(
  range: Pick<ResolvedSummaryRange, "from" | "to" | "forecastTo" | "error">,
  now = new Date(),
) {
  if (range.error) {
    return [];
  }
  const start = startOfMonth(range.from ? new Date(range.from) : now);
  const end = startOfMonth(new Date(range.forecastTo ?? range.to ?? now));
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start.getTime() > end.getTime()
  ) {
    return [];
  }
  const months: string[] = [];
  for (
    let cursor = start;
    cursor <= end && months.length < MAX_BUDGET_MONTHS;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    months.push(`${cursor.getFullYear()}-${`${cursor.getMonth() + 1}`.padStart(2, "0")}`);
  }
  return months;
}

export async function mapWithConcurrency<T, Result>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<Result>,
) {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}

export function resolveSummaryRange(input: SummaryRangeInput, now = new Date()): ResolvedSummaryRange {
  const cycleOffset = Math.min(0, Math.trunc(input.cycleOffset ?? 0));
  switch (input.mode) {
    case "all-time": {
      const referenceDate = new Date(now.getFullYear() + cycleOffset, 0, 1);
      return {
        key: cycleOffset === 0 ? `all-time:${now.getFullYear()}` : `all-time:year:${referenceDate.getFullYear()}`,
        title: "All time",
        subtitle: cycleOffset === 0
          ? `Forecast through ${now.getFullYear()} year end`
          : `${referenceDate.getFullYear()} calendar year`,
        from: cycleOffset === 0 ? undefined : startOfYear(referenceDate).toISOString(),
        to: cycleOffset === 0 ? undefined : endOfYear(referenceDate).toISOString(),
        forecastTo: endOfYear(referenceDate).toISOString(),
      };
    }
    case "last-30-days": {
      const windowEnd = shiftDays(now, cycleOffset * 30);
      const from = shiftDays(startOfDay(windowEnd), -29);
      return {
        key: `last-30-days:${from.toISOString().slice(0, 10)}`,
        title: "Last 30 days",
        from: from.toISOString(),
        to: endOfDay(windowEnd).toISOString(),
        forecastTo: endOfDay(windowEnd).toISOString(),
      };
    }
    case "last-15-days": {
      const windowEnd = shiftDays(now, cycleOffset * 15);
      const from = shiftDays(startOfDay(windowEnd), -14);
      return {
        key: `last-15-days:${from.toISOString().slice(0, 10)}`,
        title: "Last 15 days",
        from: from.toISOString(),
        to: endOfDay(windowEnd).toISOString(),
        forecastTo: endOfDay(windowEnd).toISOString(),
      };
    }
    case "custom-date": {
      if (!input.customFrom || !input.customTo) {
        return {
          key: "custom-date:incomplete",
          title: "Custom dates",
          subtitle: "Pick a start and end date",
          error: "Pick a start and end date",
        };
      }

      const customStart = parseDateInput(input.customFrom);
      const customEndDay = parseDateInput(input.customTo);
      if (!customStart || !customEndDay) {
        return invalidCustomRange("Enter valid start and end dates");
      }
      if (customStart.getTime() > customEndDay.getTime()) {
        return invalidCustomRange("Start date must be on or before end date");
      }

      const windowDays =
        Math.round((customEndDay.getTime() - customStart.getTime()) / 86_400_000) + 1;
      if (windowDays > MAX_CUSTOM_RANGE_DAYS) {
        return invalidCustomRange(`Custom ranges are limited to ${MAX_CUSTOM_RANGE_DAYS} days`);
      }

      const customEnd = endOfDay(customEndDay);
      const from = shiftDays(customStart, cycleOffset * windowDays).toISOString();
      const to = shiftDays(customEnd, cycleOffset * windowDays).toISOString();
      return {
        key: `custom-date:${from ?? ""}:${to ?? ""}`,
        title: "Custom dates",
        subtitle:
          from && to
            ? `${from.slice(0, 10)} to ${to.slice(0, 10)}`
            : "Pick a start and end date",
        from,
        to,
        forecastTo: to,
      };
    }
    case "smart-pay-cycle": {
      const paydays = parsePaydays(input.smartPaydays);
      if (paydays.length === 0) {
        const referenceDate = shiftMonths(now, cycleOffset);
        return {
          key: `smart-pay-cycle:default:${referenceDate.getFullYear()}-${`${referenceDate.getMonth() + 1}`.padStart(2, "0")}`,
          title: cycleOffset === 0 ? "Current pay cycle" : "Pay cycle",
          subtitle: "Add 2 or more payday dates in Settings",
          from: startOfMonth(referenceDate).toISOString(),
          to: (cycleOffset === 0 ? endOfDay(now) : endOfMonth(referenceDate)).toISOString(),
          forecastTo: endOfMonth(referenceDate).toISOString(),
        };
      }

      let cycleReference = now;
      for (let index = 0; index > cycleOffset; index -= 1) {
        const cycleStart = findLastPayday(cycleReference, paydays);
        cycleReference = new Date(cycleStart.getTime() - 1);
      }
      const lastPayday = findLastPayday(cycleReference, paydays);
      const nextPayday = findNextPayday(cycleReference, paydays);
      return {
        key: `smart-pay-cycle:${paydays.join("-")}:${lastPayday.toISOString().slice(0, 10)}`,
        title: cycleOffset === 0 ? "Current pay cycle" : "Pay cycle",
        subtitle: `${formatDayLabel(lastPayday)} to ${formatDayLabel(nextPayday)}`,
        from: startOfDay(lastPayday).toISOString(),
        to: endOfDay(cycleOffset === 0 ? now : nextPayday).toISOString(),
        forecastTo: endOfDay(nextPayday).toISOString(),
      };
    }
    case "this-month":
    default:
      const referenceDate = shiftMonths(now, cycleOffset);
      return {
        key: `${referenceDate.getFullYear()}-${`${referenceDate.getMonth() + 1}`.padStart(2, "0")}`,
        title: cycleOffset === 0 ? "This month" : "Month",
        subtitle: formatMonthLabel(referenceDate),
        from: startOfMonth(referenceDate).toISOString(),
        to: (cycleOffset === 0 ? endOfDay(now) : endOfMonth(referenceDate)).toISOString(),
        forecastTo: endOfMonth(referenceDate).toISOString(),
      };
  }
}

function invalidCustomRange(message: string): ResolvedSummaryRange {
  return {
    key: `custom-date:invalid:${message}`,
    title: "Custom dates",
    subtitle: message,
    error: message,
  };
}

function parseDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return startOfDay(date);
}

export function buildSpendingReport(
  rangeTitle: string,
  transactions: Transaction[],
  categories: Category[],
): MonthlyReport {
  const expenseTransactions = transactions.filter(
    (transaction) => transaction.deletedAt === null && transaction.kind === "expense",
  );
  const expenseTotal = expenseTransactions.reduce((total, transaction) => total + transaction.amount, 0);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const byCategory = Array.from(
    expenseTransactions.reduce((map, transaction) => {
      map.set(transaction.categoryId, (map.get(transaction.categoryId) ?? 0) + transaction.amount);
      return map;
    }, new Map<string, number>()),
  )
    .map(([categoryId, total]) => ({
      categoryId,
      categoryName: categoryMap.get(categoryId)?.name ?? "Uncategorized",
      total,
      budget: null,
      variance: null,
    }))
    .sort((left, right) => right.total - left.total);

  return {
    month: rangeTitle,
    expenseTotal,
    byCategory,
    budgetTotal: 0,
    budgetRemaining: 0,
  };
}

function parsePaydays(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
    ),
  ).sort((left, right) => left - right);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function shiftDays(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function shiftMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function occurrenceForMonth(baseDate: Date, day: number, monthOffset = 0) {
  const year = baseDate.getFullYear();
  const monthIndex = baseDate.getMonth() + monthOffset;
  const clampedDay = Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
  return new Date(year, monthIndex, clampedDay, 0, 0, 0, 0);
}

function findLastPayday(now: Date, paydays: number[]) {
  const candidates = [
    ...paydays.map((day) => occurrenceForMonth(now, day, -1)),
    ...paydays.map((day) => occurrenceForMonth(now, day, 0)),
  ].filter((date) => date.getTime() <= now.getTime());

  return candidates.sort((left, right) => right.getTime() - left.getTime())[0] ?? startOfMonth(now);
}

function findNextPayday(now: Date, paydays: number[]) {
  const candidates = [
    ...paydays.map((day) => occurrenceForMonth(now, day, 0)),
    ...paydays.map((day) => occurrenceForMonth(now, day, 1)),
  ].filter((date) => date.getTime() > now.getTime());

  return candidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? now;
}

function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}
