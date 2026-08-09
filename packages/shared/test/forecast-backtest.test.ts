import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "../src/schema";
import { backtestMonthlyForecast } from "../src/forecast-backtest";

const category: Category = {
  id: "food",
  userId: "user",
  name: "Food",
  kind: "expense",
  color: "#123456",
  icon: "food",
  isSystem: false,
  sortOrder: 0,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function expense(id: string, date: string, amount: number): Transaction {
  return {
    id,
    userId: "user",
    categoryId: category.id,
    amount,
    kind: "expense",
    occurredAt: `${date}T12:00:00.000Z`,
    note: null,
    merchant: `Merchant ${id}`,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    deletedAt: null,
  };
}

describe("forecast walk-forward backtest", () => {
  it("uses only data available at each historical cutoff", () => {
    const transactions = [
      ...Array.from({ length: 31 }, (_, index) => expense(`july-${index}`, `2026-07-${String(index + 1).padStart(2, "0")}`, 10)),
      ...Array.from({ length: 31 }, (_, index) => expense(`august-${index}`, `2026-08-${String(index + 1).padStart(2, "0")}`, 20)),
    ];
    const result = backtestMonthlyForecast({
      transactions,
      categories: [category],
      cutoffDays: [7, 14, 21],
      through: "2026-09-01T00:00:00.000Z",
    });

    expect(result.snapshots).toHaveLength(6);
    expect(result.snapshots.find((snapshot) => snapshot.month === "2026-07" && snapshot.cutoffDay === 7)?.actualTotal).toBe(310);
    expect(result.snapshots.find((snapshot) => snapshot.month === "2026-08" && snapshot.cutoffDay === 7)?.actualTotal).toBe(620);
    expect(result.weightedAbsolutePercentageError).toBeGreaterThanOrEqual(0);
    expect(result.intervalCoverage).toBeGreaterThanOrEqual(0);
    expect(result.intervalCoverage).toBeLessThanOrEqual(1);
  });
});
