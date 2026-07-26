import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { deleteCountdown, getCountdown, upsertCountdown } from "../src/repositories";

test("countdown lifecycle is stored per account", () => {
  runMigrations();
  const userId = `qa-countdown-${nanoid()}`;
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, sync_code, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (?, ?, 'Countdown QA', NULL, ?, ?, NULL, 1, 'USD', ?, ?, ?)
    `,
  ).run(userId, `${userId}@example.test`, `google-${userId}`, `device-${userId}`, now, now, now);

  try {
    assert.equal(getCountdown(userId), null);

    const created = upsertCountdown(userId, {
      title: "Pay day",
      targetAt: "2026-08-15T00:00:00.000Z",
      createdAt: "2026-07-26T00:00:00.000Z",
    });
    assert.equal(created.title, "Pay day");
    assert.equal(created.userId, userId);
    assert.equal(created.createdAt, "2026-07-26T00:00:00.000Z");

    const updated = upsertCountdown(userId, {
      title: "Holiday",
      targetAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(updated.title, "Holiday");
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(getCountdown(userId)?.targetAt, "2026-09-01T00:00:00.000Z");

    deleteCountdown(userId);
    assert.equal(getCountdown(userId), null);
  } finally {
    db.prepare("DELETE FROM countdowns WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});
