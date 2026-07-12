import test from "node:test";
import assert from "node:assert/strict";
import { runMigrations } from "../src/db/migrate";
import { getMonthlyReport } from "../src/repositories";

test("monthly report returns the expected shape for the demo user", () => {
  runMigrations();
  const report = getMonthlyReport("demo-user", "2026-07");

  assert.equal(report.month, "2026-07");
  assert.equal(Array.isArray(report.byCategory), true);
  assert.equal(typeof report.expenseTotal, "number");
  assert.equal("incomeTotal" in report, false);
  assert.equal("net" in report, false);
});
