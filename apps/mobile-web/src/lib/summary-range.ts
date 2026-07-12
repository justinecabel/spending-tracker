import type { Category, MonthlyReport, Transaction } from "@spending-tracker/shared";
import type { SummaryRangeMode } from "../state/summary-range";

type SummaryRangeInput = {
  mode: SummaryRangeMode;
  customFrom: string;
  customTo: string;
  smartPaydays: string;
};

export type ResolvedSummaryRange = {
  key: string;
  title: string;
  subtitle?: string;
  from?: string;
  to?: string;
  forecastTo?: string;
};

export function resolveSummaryRange(input: SummaryRangeInput, now = new Date()): ResolvedSummaryRange {
  switch (input.mode) {
    case "all-time":
      return {
        key: "all-time",
        title: "All time",
        subtitle: `Forecast through ${now.getFullYear()} year end`,
        forecastTo: endOfYear(now).toISOString(),
      };
    case "last-30-days": {
      const from = shiftDays(startOfDay(now), -29);
      return {
        key: `last-30-days:${from.toISOString().slice(0, 10)}`,
        title: "Last 30 days",
        from: from.toISOString(),
        to: endOfDay(now).toISOString(),
        forecastTo: endOfDay(now).toISOString(),
      };
    }
    case "last-15-days": {
      const from = shiftDays(startOfDay(now), -14);
      return {
        key: `last-15-days:${from.toISOString().slice(0, 10)}`,
        title: "Last 15 days",
        from: from.toISOString(),
        to: endOfDay(now).toISOString(),
        forecastTo: endOfDay(now).toISOString(),
      };
    }
    case "custom-date": {
      const from = input.customFrom ? startOfDay(new Date(`${input.customFrom}T00:00:00`)).toISOString() : undefined;
      const to = input.customTo ? endOfDay(new Date(`${input.customTo}T00:00:00`)).toISOString() : undefined;
      return {
        key: `custom-date:${input.customFrom}:${input.customTo}`,
        title: "Custom dates",
        subtitle:
          input.customFrom && input.customTo
            ? `${input.customFrom} to ${input.customTo}`
            : "Pick a start and end date",
        from,
        to,
        forecastTo: to,
      };
    }
    case "smart-pay-cycle": {
      const paydays = parsePaydays(input.smartPaydays);
      if (paydays.length === 0) {
        return {
          key: "smart-pay-cycle:default",
          title: "Current pay cycle",
          subtitle: "Add 2 or more payday dates in Settings",
          from: startOfMonth(now).toISOString(),
          to: endOfDay(now).toISOString(),
          forecastTo: endOfMonth(now).toISOString(),
        };
      }

      const lastPayday = findLastPayday(now, paydays);
      const nextPayday = findNextPayday(now, paydays);
      return {
        key: `smart-pay-cycle:${paydays.join("-")}:${lastPayday.toISOString().slice(0, 10)}`,
        title: "Current pay cycle",
        subtitle: `${formatDayLabel(lastPayday)} to ${formatDayLabel(nextPayday)}`,
        from: startOfDay(lastPayday).toISOString(),
          to: endOfDay(now).toISOString(),
          forecastTo: endOfDay(nextPayday).toISOString(),
      };
    }
    case "this-month":
    default:
      return {
        key: `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`,
        title: "This month",
        from: startOfMonth(now).toISOString(),
        to: endOfDay(now).toISOString(),
        forecastTo: endOfMonth(now).toISOString(),
      };
  }
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

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function shiftDays(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
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
