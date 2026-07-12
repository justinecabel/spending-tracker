import { describe, expect, it } from "vitest";
import { formatMoney, monthKey } from "../src/lib/date";

describe("date helpers", () => {
  it("builds a YYYY-MM month key", () => {
    expect(monthKey(new Date("2026-07-08T00:00:00.000Z"))).toBe("2026-07");
  });

  it("formats money with currency", () => {
    expect(formatMoney(10, "USD")).toContain("$10");
  });
});
