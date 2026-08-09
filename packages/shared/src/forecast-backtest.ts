import type { Budget, Category, Transaction } from "./schema";
import { buildForecastAnalysis, type ForecastConfidenceLabel } from "./forecast";

export type ForecastBacktestSnapshot = {
  month: string;
  cutoffDay: number;
  actualTotal: number;
  projectedTotal: number;
  error: number;
  absolutePercentageError: number;
  confidenceLabel: ForecastConfidenceLabel;
};

export type ForecastBacktestSummary = {
  snapshots: ForecastBacktestSnapshot[];
  weightedAbsolutePercentageError: number;
  bias: number;
  intervalCoverage: number;
};

type ForecastBacktestInput = {
  transactions: Transaction[];
  categories: Category[];
  budgets?: Budget[];
  cutoffDays?: number[];
  through?: Date | string;
};

/**
 * Replays completed calendar months without exposing future transactions to
 * the forecast. This is deliberately kept beside the model so every model
 * revision can be compared against the same walk-forward evaluation.
 */
export function backtestMonthlyForecast(input: ForecastBacktestInput): ForecastBacktestSummary {
  const through = input.through instanceof Date ? input.through : new Date(input.through ?? new Date());
  const cutoffDays = input.cutoffDays ?? [7, 14, 21];
  const expenses = dedupeTransactions(input.transactions)
    .filter((transaction) => transaction.kind === "expense" && transaction.deletedAt === null)
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  const months = [...new Set(expenses.map((transaction) => transaction.occurredAt.slice(0, 7)))].sort();
  const snapshots: ForecastBacktestSnapshot[] = [];
  let covered = 0;

  for (const month of months) {
    const [year, monthNumber] = month.split("-").map(Number);
    const periodStart = new Date(year!, monthNumber! - 1, 1);
    const periodEnd = new Date(year!, monthNumber!, 0, 23, 59, 59, 999);
    if (periodEnd > through) continue;

    const actualTotal = expenses
      .filter((transaction) => inRange(transaction, periodStart, periodEnd))
      .reduce((total, transaction) => total + transaction.amount, 0);
    if (actualTotal <= 0) continue;

    for (const cutoffDay of cutoffDays) {
      if (cutoffDay < 1 || cutoffDay >= periodEnd.getDate()) continue;
      const observedEnd = new Date(year!, monthNumber! - 1, cutoffDay, 23, 59, 59, 999);
      const historyTransactions = expenses.filter(
        (transaction) => new Date(transaction.occurredAt) <= observedEnd,
      );
      const transactions = historyTransactions.filter((transaction) =>
        inRange(transaction, periodStart, observedEnd),
      );
      if (transactions.length === 0) continue;

      const forecast = buildForecastAnalysis({
        transactions,
        historyTransactions,
        categories: input.categories,
        budgets: input.budgets,
        range: {
          title: month,
          from: periodStart.toISOString(),
          to: observedEnd.toISOString(),
          forecastTo: periodEnd.toISOString(),
        },
        now: observedEnd,
      });
      const error = forecast.projectedTotal - actualTotal;
      if (actualTotal >= forecast.forecastLow && actualTotal <= forecast.forecastHigh) covered += 1;
      snapshots.push({
        month,
        cutoffDay,
        actualTotal,
        projectedTotal: forecast.projectedTotal,
        error,
        absolutePercentageError: Math.abs(error) / actualTotal,
        confidenceLabel: forecast.confidenceLabel,
      });
    }
  }

  const actualTotal = snapshots.reduce((total, snapshot) => total + snapshot.actualTotal, 0);
  const absoluteError = snapshots.reduce((total, snapshot) => total + Math.abs(snapshot.error), 0);
  const error = snapshots.reduce((total, snapshot) => total + snapshot.error, 0);
  return {
    snapshots,
    weightedAbsolutePercentageError: actualTotal ? absoluteError / actualTotal : 0,
    bias: actualTotal ? error / actualTotal : 0,
    intervalCoverage: snapshots.length ? covered / snapshots.length : 0,
  };
}

function inRange(transaction: Transaction, start: Date, end: Date) {
  const occurredAt = new Date(transaction.occurredAt);
  return occurredAt >= start && occurredAt <= end;
}

function dedupeTransactions(transactions: Transaction[]) {
  const byId = new Map<string, Transaction>();
  for (const transaction of transactions) byId.set(transaction.id, transaction);
  return [...byId.values()];
}
