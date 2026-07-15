import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "@spending-tracker/shared";
import { buildAiPredictionDataSignature } from "../src/hooks/use-ai-prediction";

const transaction: Transaction = {
  id: "transaction-1",
  userId: "user-1",
  categoryId: "category-1",
  amount: 25,
  kind: "expense",
  occurredAt: "2026-07-15T00:00:00.000Z",
  note: null,
  merchant: "Store",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  deletedAt: null,
};

const category: Category = {
  id: "category-1",
  userId: "user-1",
  name: "Food",
  kind: "expense",
  color: "#00aa88",
  icon: "food",
  isSystem: false,
  sortOrder: 0,
  archived: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("AI prediction cache signature", () => {
  it("changes when transaction or category data changes", () => {
    const base = buildAiPredictionDataSignature("USD", [transaction], [category]);
    const changedTransaction = buildAiPredictionDataSignature(
      "USD",
      [{ ...transaction, amount: 30, updatedAt: "2026-07-15T00:01:00.000Z" }],
      [category],
    );
    const changedCategory = buildAiPredictionDataSignature(
      "USD",
      [transaction],
      [{ ...category, name: "Groceries", updatedAt: "2026-07-15T00:02:00.000Z" }],
    );

    expect(changedTransaction).not.toBe(base);
    expect(changedCategory).not.toBe(base);
  });
});
