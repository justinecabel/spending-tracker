import { describe, expect, it } from "vitest";
import type { Debt } from "../src/schema";
import { buildSimulatedDebtScore } from "../src/debt-score";

const now = new Date("2026-07-22T12:00:00.000Z");

function debt(overrides: Partial<Debt>): Debt {
  return {
    id: overrides.id ?? `debt-${Math.random()}`,
    userId: "user",
    categoryId: "category",
    merchant: "Merchant",
    amount: 100,
    dueAt: "2026-07-10T12:00:00.000Z",
    reminderDaysBefore: null,
    paidAt: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("simulated debt score", () => {
  it("returns a neutral low-confidence score without history", () => {
    expect(buildSimulatedDebtScore([], now)).toMatchObject({ score: 650, band: "No history", confidence: "Low" });
  });

  it("rewards consistent on-time payment history", () => {
    const debts = Array.from({ length: 8 }, (_, index) => debt({
      id: `paid-${index}`,
      dueAt: `2026-0${Math.max(1, index)}-15T12:00:00.000Z`,
      paidAt: `2026-0${Math.max(1, index)}-14T12:00:00.000Z`,
    }));
    const result = buildSimulatedDebtScore(debts, now);
    expect(result.score).toBeGreaterThanOrEqual(800);
    expect(result.band).toBe("Excellent");
    expect(result.confidence).toBe("High");
  });

  it("penalizes unpaid overdue obligations", () => {
    const result = buildSimulatedDebtScore([
      debt({ id: "overdue-1", amount: 400 }),
      debt({ id: "overdue-2", amount: 600, dueAt: "2026-06-10T12:00:00.000Z" }),
    ], now);
    expect(result.score).toBeLessThan(580);
    expect(result.factors.some((factor) => factor.label === "Overdue obligations" && factor.tone === "negative")).toBe(true);
  });
});
