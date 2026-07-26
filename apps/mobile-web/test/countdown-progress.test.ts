import { describe, expect, it } from "vitest";
import { calculateCountdownProgress } from "../src/lib/countdown-progress";

function localIso(year: number, month: number, day: number, hour = 0) {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("countdown progress", () => {
  it("starts a newly created four-day countdown at 100 percent", () => {
    const result = calculateCountdownProgress(
      localIso(2026, 7, 30),
      localIso(2026, 7, 26, 10),
      new Date(2026, 6, 26, 15),
    );

    expect(result).toEqual({
      daysRemaining: 4,
      totalDays: 4,
      fillPercent: 100,
      expired: false,
    });
  });

  it("subtracts the first daily step on the following day", () => {
    const result = calculateCountdownProgress(
      localIso(2026, 7, 30),
      localIso(2026, 7, 26, 10),
      new Date(2026, 6, 27, 10),
    );

    expect(result).toEqual({
      daysRemaining: 3,
      totalDays: 4,
      fillPercent: 75,
      expired: false,
    });
  });

  it("preserves the original baseline when an existing countdown is edited", () => {
    const result = calculateCountdownProgress(
      localIso(2026, 7, 30),
      localIso(2026, 7, 22, 10),
      new Date(2026, 6, 26, 10),
    );

    expect(result).toEqual({
      daysRemaining: 4,
      totalDays: 8,
      fillPercent: 50,
      expired: false,
    });
  });

  it("is empty and complete when the target is today", () => {
    const result = calculateCountdownProgress(
      localIso(2026, 7, 26),
      localIso(2026, 7, 22, 10),
      new Date(2026, 6, 26, 10),
    );

    expect(result).toEqual({
      daysRemaining: 0,
      totalDays: 4,
      fillPercent: 0,
      expired: true,
    });
  });
});
