import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { getTransactions } from "../src/repositories";

test("transaction reads enforce bounded pages while preserving page traversal", () => {
  runMigrations();
  const userId = `pagination-user-${nanoid()}`;
  const categoryId = `pagination-category-${nanoid()}`;
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, device_secret_hash, sync_code, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (?, ?, 'Pagination QA', NULL, ?, ?, NULL, NULL, 1, 'USD', ?, ?, ?)
    `,
  ).run(userId, `${userId}@example.test`, `google-${userId}`, `device-${userId}`, now, now, now);
  db.prepare(
    `
      INSERT INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
      VALUES (?, ?, 'Other', 'expense', '#000000', 'circle', 1, 0, 0, ?, ?)
    `,
  ).run(categoryId, userId, now, now);

  try {
    const insert = db.prepare(
      `
        INSERT INTO transactions
          (id, user_id, category_id, amount, kind, occurred_at, note, merchant, client_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, 1, 'expense', ?, NULL, NULL, NULL, ?, ?, NULL)
      `,
    );
    for (let index = 0; index < 205; index += 1) {
      const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      insert.run(`transaction-${userId}-${index}`, userId, categoryId, occurredAt, occurredAt, occurredAt);
    }

    assert.equal(getTransactions(userId, {}).length, 200);
    assert.equal(getTransactions(userId, { limit: "200", offset: "200" }).length, 5);
    assert.throws(
      () => getTransactions(userId, { limit: "201" }),
      /Too big|less than or equal to 200/i,
    );
  } finally {
    db.prepare("DELETE FROM transactions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});
