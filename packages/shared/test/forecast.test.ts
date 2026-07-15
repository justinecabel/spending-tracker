import { describe, expect, test } from "vitest";
import type { Budget, Category, Transaction } from "../src/schema";
import { buildForecastAnalysis } from "../src/forecast";

const category: Category = {
  id: "food",
  userId: "user",
  name: "Food",
  kind: "expense",
  color: "#0F766E",
  icon: "food",
  isSystem: false,
  sortOrder: 0,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function transaction(id: string, date: string, amount: number, merchant = "Cafe"): Transaction {
  return {
    id,
    userId: "user",
    categoryId: category.id,
    amount,
    kind: "expense",
    occurredAt: `${date}T12:00:00.000Z`,
    note: null,
    merchant,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    deletedAt: null,
  };
}

function localIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(year, month - 1, day, hour, minute, second, millisecond).toISOString();
}

const range = {
  title: "This month",
  from: localIso(2026, 7, 1),
  to: localIso(2026, 7, 15, 23, 59, 59, 999),
  forecastTo: localIso(2026, 7, 31, 23, 59, 59, 999),
};

describe("buildForecastAnalysis", () => {
  test("uses a conservative low-confidence result for sparse data", () => {
    const result = buildForecastAnalysis({
      transactions: [transaction("a", "2026-07-02", 20), transaction("b", "2026-07-10", 30)],
      categories: [category],
      range,
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.actualTotal).toBe(50);
    expect(result.futureDays).toBe(16);
    expect(result.confidenceLabel).toBe("Low");
    expect(result.dataQualityNotes[0]).toContain("Limited history");
  });

  test("reconciles points and category projections to the projected total", () => {
    const transactions = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 5, 16 + index));
      return transaction(`steady-${index}`, date.toISOString().slice(0, 10), 10, index % 2 ? "Cafe" : "Market");
    });
    const result = buildForecastAnalysis({
      transactions: transactions.filter((item) => item.occurredAt >= range.from!),
      historyTransactions: transactions,
      categories: [category],
      range,
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.projectedTotal).toBeGreaterThan(result.actualTotal);
    expect(result.points.reduce((total, point) => total + point.projected, 0)).toBeCloseTo(result.projectedTotal, 6);
    expect(result.categories.reduce((total, item) => total + item.projected, 0)).toBeCloseTo(result.projectedTotal - result.actualTotal + result.actualTotal, 6);
  });

  test("detects a consistent monthly recurring pattern", () => {
    const transactions = [
      transaction("r1", "2026-05-01", 50, "Subscription"),
      transaction("r2", "2026-06-01", 50, "Subscription"),
      transaction("r3", "2026-07-01", 50, "Subscription"),
    ];
    const result = buildForecastAnalysis({
      transactions: [],
      historyTransactions: transactions,
      categories: [category],
      range: { title: "Next month", from: localIso(2026, 7, 1), to: localIso(2026, 7, 15, 23, 59, 59, 999), forecastTo: localIso(2026, 8, 15, 23, 59, 59, 999) },
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.recurring[0]?.label).toBe("Subscription");
    expect(result.recurring[0]?.cadence).toBe("Monthly");
    expect(result.recurring[0]?.expectedAmount).toBe(50);
    expect(result.recurring[0]?.expectedOccurrences).toBeGreaterThan(0);
  });

  test("prorates a monthly budget over a partial selected period", () => {
    const budget: Budget = {
      id: "budget",
      userId: "user",
      categoryId: null,
      month: "2026-07",
      amount: 310,
      rollover: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = buildForecastAnalysis({
      transactions: [transaction("spent", "2026-07-15", 20)],
      categories: [category],
      budgets: [budget],
      range,
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.budget.budget).toBeCloseTo(310, 6);
    expect(result.budget.variance).not.toBeNull();
  });

  test("shows actuals without a forecast when no future days remain", () => {
    const result = buildForecastAnalysis({
      transactions: [transaction("today", "2026-07-15", 42)],
      categories: [category],
      range: { title: "Closed range", from: localIso(2026, 7, 1), to: localIso(2026, 7, 15, 23, 59, 59, 999), forecastTo: localIso(2026, 7, 15, 23, 59, 59, 999) },
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.futureDays).toBe(0);
    expect(result.projectedTotal).toBe(42);
    expect(result.forecastLow).toBe(42);
    expect(result.forecastHigh).toBe(42);
    expect(result.points.every((point) => point.actual !== null)).toBe(true);
  });

  test("keeps an outlier from dominating the future rate", () => {
    const transactions = [
      ...Array.from({ length: 20 }, (_, index) => transaction(`normal-${index}`, `2026-06-${String(index + 1).padStart(2, "0")}`, 10, "Daily")),
      transaction("outlier", "2026-07-05", 1000, "Emergency"),
    ];
    const result = buildForecastAnalysis({
      transactions: transactions.filter((item) => item.occurredAt >= range.from!),
      historyTransactions: transactions,
      categories: [category],
      range,
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(result.unusualTransactions[0]?.label).toBe("Emergency");
    expect(result.dataQualityNotes).toContain("High spending variation widens the forecast range");
    expect(result.projectedTotal).toBeLessThan(result.actualTotal + 1000);
  });
});
