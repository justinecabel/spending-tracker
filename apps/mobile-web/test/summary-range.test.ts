import { describe, expect, it } from "vitest";
import { resolveSummaryRange } from "../src/lib/summary-range";

const baseInput = {
  customFrom: "",
  customTo: "",
  smartPaydays: "15,30",
} as const;

function localDate(iso: string | undefined) {
  const date = new Date(iso ?? "");
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

describe("resolveSummaryRange cycle navigation", () => {
  const now = new Date(2026, 6, 16, 12);

  it("always labels the current monthly period", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "this-month" }, now);

    expect(range.subtitle).toBe("July 2026");
  });

  it("moves this-month to the previous complete month", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "this-month", cycleOffset: -1 }, now);

    expect(range.key).toBe("2026-06");
    expect(localDate(range.from)).toBe("2026-06-01");
    expect(localDate(range.to)).toBe("2026-06-30");
  });

  it("can move back more than one monthly cycle across a year boundary", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "this-month", cycleOffset: -8 }, now);

    expect(range.key).toBe("2025-11");
    expect(localDate(range.from)).toBe("2025-11-01");
    expect(localDate(range.to)).toBe("2025-11-30");
  });

  it("moves rolling windows back by their full length", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "last-30-days", cycleOffset: -1 }, now);

    expect(localDate(range.from)).toBe("2026-05-18");
    expect(localDate(range.to)).toBe("2026-06-16");
  });

  it("moves custom ranges back by the selected range length", () => {
    const range = resolveSummaryRange({
      ...baseInput,
      mode: "custom-date",
      customFrom: "2026-07-01",
      customTo: "2026-07-10",
      cycleOffset: -1,
    }, now);

    expect(localDate(range.from)).toBe("2026-06-21");
    expect(localDate(range.to)).toBe("2026-06-30");
  });

  it("moves smart pay cycles to the preceding payday interval", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "smart-pay-cycle", cycleOffset: -1 }, now);

    expect(localDate(range.from)).toBe("2026-06-30");
    expect(localDate(range.to)).toBe("2026-07-15");
  });

  it("moves the year-end view to the previous calendar year", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "all-time", cycleOffset: -1 }, now);

    expect(range.key).toBe("all-time:year:2025");
    expect(localDate(range.from)).toBe("2025-01-01");
    expect(localDate(range.to)).toBe("2025-12-31");
  });

  it("keeps leap day inside a previous leap-year view", () => {
    const range = resolveSummaryRange({ ...baseInput, mode: "all-time", cycleOffset: -2 }, now);

    expect(range.key).toBe("all-time:year:2024");
    expect(localDate(range.from)).toBe("2024-01-01");
    expect(localDate(range.to)).toBe("2024-12-31");
  });
});
