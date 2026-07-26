import { describe, expect, it } from "vitest";
import type { Debt } from "../src/schema";
import { buildDebtPaymentHealth } from "../src/debt-score";

const now = new Date("2026-07-22T12:00:00.000Z");
let debtSequence = 0;

function debt(overrides: Partial<Debt> = {}): Debt {
  debtSequence += 1;
  return {
    id: overrides.id ?? `debt-${debtSequence}`,
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

describe("debt payment health", () => {
  it("does not fabricate a score without evaluated history", () => {
    expect(buildDebtPaymentHealth([], now)).toMatchObject({
      score: null,
      band: "Insufficient history",
      confidence: "Low",
      evaluatedCount: 0,
    });
  });

  it("does not score future unpaid obligations", () => {
    const result = buildDebtPaymentHealth([
      debt({ dueAt: "2026-08-10T12:00:00.000Z" }),
    ], now);

    expect(result.score).toBeNull();
    expect(result.factors[0].detail).toContain("1 upcoming item");
  });

  it("reports excellent but low-confidence behavior after one on-time payment", () => {
    expect(buildDebtPaymentHealth([
      debt({ dueAt: "2026-07-10T12:00:00.000Z", paidAt: "2026-07-10T12:00:00.000Z" }),
    ], now)).toMatchObject({
      score: 100,
      band: "Excellent",
      confidence: "Low",
      evaluatedCount: 1,
    });
  });

  it("raises confidence only when history is deep and spans enough time", () => {
    const debts = Array.from({ length: 13 }, (_, index) => {
      const due = new Date(Date.UTC(2025, 6 + index, 10, 12));
      return debt({
        id: `paid-${index}`,
        dueAt: due.toISOString(),
        paidAt: due.toISOString(),
      });
    });

    expect(buildDebtPaymentHealth(debts, now)).toMatchObject({
      score: 100,
      band: "Excellent",
      confidence: "High",
    });
  });

  it("uses transparent late-payment severity buckets", () => {
    const dueAt = "2026-05-01T12:00:00.000Z";

    expect(buildDebtPaymentHealth([debt({ dueAt, paidAt: "2026-05-02T12:00:00.000Z" })], now).score).toBe(70);
    expect(buildDebtPaymentHealth([debt({ dueAt, paidAt: "2026-06-05T12:00:00.000Z" })], now).score).toBe(40);
    expect(buildDebtPaymentHealth([debt({ dueAt, paidAt: "2026-07-05T12:00:00.000Z" })], now).score).toBe(15);
  });

  it("gives recent behavior more weight than older behavior", () => {
    const oldLate = debt({
      dueAt: "2025-01-01T12:00:00.000Z",
      paidAt: "2025-04-01T12:00:00.000Z",
    });
    const oldOnTime = debt({
      dueAt: "2025-01-01T12:00:00.000Z",
      paidAt: "2025-01-01T12:00:00.000Z",
    });
    const recentLate = debt({
      dueAt: "2026-04-25T12:00:00.000Z",
      paidAt: "2026-07-20T12:00:00.000Z",
    });
    const recentOnTime = debt({
      dueAt: "2026-04-25T12:00:00.000Z",
      paidAt: "2026-04-25T12:00:00.000Z",
    });

    expect(buildDebtPaymentHealth([oldLate, recentOnTime], now).score)
      .toBeGreaterThan(buildDebtPaymentHealth([oldOnTime, recentLate], now).score!);
  });

  it("lets an unpaid overdue item worsen as delinquency ages", () => {
    const recent = buildDebtPaymentHealth([
      debt({ dueAt: "2026-07-21T12:00:00.000Z" }),
    ], now);
    const severe = buildDebtPaymentHealth([
      debt({ dueAt: "2026-04-01T12:00:00.000Z" }),
    ], now);

    expect(recent.score).toBe(70);
    expect(severe.score).toBe(0);
    expect(severe.factors.some((factor) => factor.label === "Late-payment severity" && factor.tone === "negative")).toBe(true);
  });

  it("does not treat debt amount as credit utilization", () => {
    const small = buildDebtPaymentHealth([
      debt({ amount: 10, dueAt: "2026-07-10T12:00:00.000Z", paidAt: "2026-07-10T12:00:00.000Z" }),
    ], now);
    const large = buildDebtPaymentHealth([
      debt({ amount: 1_000_000, dueAt: "2026-07-10T12:00:00.000Z", paidAt: "2026-07-10T12:00:00.000Z" }),
    ], now);

    expect(large.score).toBe(small.score);
  });

  it("excludes future items and limits explanations to four", () => {
    const evaluated = debt({
      dueAt: "2026-07-10T12:00:00.000Z",
      paidAt: "2026-07-15T12:00:00.000Z",
    });
    const future = debt({ dueAt: "2026-08-10T12:00:00.000Z" });

    const withoutFuture = buildDebtPaymentHealth([evaluated], now);
    const withFuture = buildDebtPaymentHealth([evaluated, future], now);

    expect(withFuture.score).toBe(withoutFuture.score);
    expect(withFuture.factors.length).toBeLessThanOrEqual(4);
  });
});
