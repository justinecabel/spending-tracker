import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { createDebt, deleteDebt, getDebts, updateDebt } from "../src/repositories";

test("debt lifecycle works without a user-selected category", () => {
  runMigrations();
  const userId = `qa-debt-${nanoid()}`;
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, sync_code, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (?, ?, 'Debt QA', NULL, ?, ?, NULL, 1, 'USD', ?, ?, ?)
    `,
  ).run(userId, `${userId}@example.test`, `google-${userId}`, `device-${userId}`, now, now, now);

  try {
    const created = createDebt(userId, {
      merchant: "Before",
      amount: 12.34,
      dueAt: "2026-07-22T01:00:00.000Z",
      reminderDaysBefore: null,
    });
    assert.equal(created.merchant, "Before");
    assert.ok(created.categoryId);

    const idempotent = createDebt(userId, {
      merchant: "Retry-safe",
      amount: 40,
      dueAt: "2026-07-23T01:00:00.000Z",
      reminderDaysBefore: null,
      clientId: `debt-client-${userId}`,
    });
    const retried = createDebt(userId, {
      merchant: "Retry-safe",
      amount: 40,
      dueAt: "2026-07-23T01:00:00.000Z",
      reminderDaysBefore: null,
      clientId: `debt-client-${userId}`,
    });
    assert.equal(retried.id, idempotent.id);

    const updated = updateDebt(userId, created.id, {
      merchant: "After",
      amount: 23.45,
      paidAt: now,
    });
    assert.equal(updated.merchant, "After");
    assert.equal(updated.amount, 23.45);
    assert.equal(updated.paidAt, now);

    deleteDebt(userId, created.id);
    deleteDebt(userId, idempotent.id);
    assert.deepEqual(getDebts(userId), []);
  } finally {
    db.prepare("DELETE FROM debts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});
