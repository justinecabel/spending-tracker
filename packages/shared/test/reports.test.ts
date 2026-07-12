import { describe, expect, it } from "vitest";
import { buildMonthlyReport } from "../src/reports";
import type { Budget, Category, Transaction } from "../src/schema";

const categories: Category[] = [
  {
    id: "cat-food",
    userId: "user-1",
    name: "Food",
    kind: "expense",
    color: "#22C55E",
    icon: "utensils",
    isSystem: false,
    sortOrder: 0,
    archived: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
];

const transactions: Transaction[] = [
  {
    id: "txn-1",
    userId: "user-1",
    categoryId: "cat-food",
    amount: 50,
    kind: "expense",
    occurredAt: "2026-07-04T00:00:00.000Z",
    note: null,
    merchant: "Market",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    deletedAt: null,
  },
];

const budgets: Budget[] = [
  {
    id: "budget-1",
    userId: "user-1",
    categoryId: "cat-food",
    month: "2026-07",
    amount: 200,
    rollover: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
];

describe("buildMonthlyReport", () => {
  it("aggregates expenses and category budgets", () => {
    const report = buildMonthlyReport("2026-07", transactions, categories, budgets);

    expect(report.expenseTotal).toBe(50);
    expect(report.byCategory[0]).toMatchObject({
      categoryId: "cat-food",
      categoryName: "Food",
      total: 50,
      budget: 200,
      variance: 150,
    });
  });
});
