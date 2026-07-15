import { strict as assert } from "node:assert";
import test from "node:test";
import type { AiPredictionRequest, AiPredictionResponse } from "@spending-tracker/shared";
import { normalizePrediction } from "../src/ai-prediction";

const input: AiPredictionRequest = {
  instruction: "Forecast from history and habits.",
  range: {
    title: "This month",
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T23:59:59.999Z",
    forecastTo: "2026-08-31T23:59:59.999Z",
  },
  currency: "USD",
  categoryNames: ["Payment", "Grocery", "Transport"],
  forecastDates: ["2026-08-01", "2026-08-02"],
  transactions: [
    { amount: 123_213_123, occurredAt: "2026-07-15T00:00:00.000Z", category: "Payment", merchant: "Transaction", note: null },
    { amount: 50, occurredAt: "2026-07-12T00:00:00.000Z", category: "Grocery", merchant: "Store", note: null },
    { amount: 13, occurredAt: "2026-07-12T00:00:00.000Z", category: "Transport", merchant: "Jeepney", note: null },
    { amount: 13, occurredAt: "2026-07-13T00:00:00.000Z", category: "Transport", merchant: "Jeepney", note: null },
  ],
};

test("normalizes AI output around observed spend and repeated habits", () => {
  const modelPrediction: AiPredictionResponse = {
    projectedTotal: 999_999_999,
    categories: [
      { category: "Payment", projectedTotal: 999_999_999 },
      { category: "Grocery", projectedTotal: 100 },
      { category: "Transport", projectedTotal: 60 },
      { category: "Invented category", projectedTotal: 10_000 },
    ],
    points: [
      { date: "2026-08-01", projectedAmount: 999_999_999 },
      { date: "2026-08-02", projectedAmount: 999_999_999 },
    ],
  };

  const result = normalizePrediction(modelPrediction, input);

  assert.equal(result.projectedTotal, 123_213_283);
  assert.deepEqual(result.categories.map((category) => category.category), ["Payment", "Grocery", "Transport"]);
  assert.equal(result.categories[0].projectedTotal, 123_213_123);
  assert.equal(result.categories[1].projectedTotal, 100);
  assert.equal(result.categories[2].projectedTotal, 60);
  assert.deepEqual(result.points.map((point) => point.projectedAmount), [42, 42]);
});
