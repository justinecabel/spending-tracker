import { describe, expect, it } from "vitest";
import { combineDateAndTime, formatMoney, monthKey, rollMonthlyDateForward, toTimeInputValue } from "../src/lib/date";

describe("date helpers", () => {
  it("builds a YYYY-MM month key", () => {
    expect(monthKey(new Date("2026-07-08T00:00:00.000Z"))).toBe("2026-07");
  });

  it("formats money with currency", () => {
    expect(formatMoney(10, "USD")).toContain("$10");
  });

  it("formats time inputs for the native browser time picker", () => {
    expect(toTimeInputValue(new Date(2026, 7, 22, 0, 5))).toBe("00:05");
    expect(toTimeInputValue(new Date(2026, 7, 22, 13, 30))).toBe("13:30");
  });

  it("combines AM/PM time input values", () => {
    const result = new Date(combineDateAndTime("2026-08-22", "9:15 PM"));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(7);
    expect(result.getDate()).toBe(22);
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(15);
  });

  it("rolls a past monthly due date forward while preserving its day and time", () => {
    const result = rollMonthlyDateForward(
      new Date(2026, 4, 15, 9, 30),
      new Date(2026, 6, 22, 12, 0),
    );
    expect(result).toEqual(new Date(2026, 7, 15, 9, 30));
  });

  it("clamps monthly dates to the last valid day", () => {
    const result = rollMonthlyDateForward(
      new Date(2026, 0, 31, 9, 0),
      new Date(2026, 1, 1, 12, 0),
    );
    expect(result).toEqual(new Date(2026, 1, 28, 9, 0));
  });
});
