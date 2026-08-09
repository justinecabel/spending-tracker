import { describe, expect, it } from "vitest";
import { shouldApplyPwaHandoffValue } from "../src/lib/storage";

describe("PWA storage handoff", () => {
  it.each([
    "spending-tracker-offline-cache",
    "spending-tracker-sync-queue",
    "spending-tracker-drafts",
    "spending-tracker-countdowns",
    "spending-tracker-session",
    "spending-tracker-device-id",
    "spending-tracker-device-secret",
  ])("does not replace existing PWA state for %s", (key) => {
    expect(shouldApplyPwaHandoffValue(key, "newer-device-state")).toBe(false);
  });

  it("seeds device-owned state in a fresh PWA storage container", () => {
    expect(shouldApplyPwaHandoffValue("spending-tracker-offline-cache", null)).toBe(true);
  });

  it("seeds identity state only when the PWA does not have it", () => {
    expect(shouldApplyPwaHandoffValue("spending-tracker-session", null)).toBe(true);
    expect(shouldApplyPwaHandoffValue("spending-tracker-device-id", null)).toBe(true);
    expect(shouldApplyPwaHandoffValue("spending-tracker-device-secret", null)).toBe(true);
  });

  it("rejects handoff metadata and unrelated storage", () => {
    expect(shouldApplyPwaHandoffValue("spending-tracker-pwa-handoff", null)).toBe(false);
    expect(shouldApplyPwaHandoffValue("spending-tracker-pwa-handoff-applied", null)).toBe(false);
    expect(shouldApplyPwaHandoffValue("another-app-cache", null)).toBe(false);
  });
});
