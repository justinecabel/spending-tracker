import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import {
  authenticateOrCreateDeviceUserWithName,
  consumeTransferToken,
  createSession,
  createTransferToken,
  refreshSession,
} from "../src/auth";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

const DEVICE_SECRET = "a".repeat(43);
const WRONG_DEVICE_SECRET = "b".repeat(43);

test("a visible device ID cannot authenticate without its separate device secret", () => {
  runMigrations();
  const deviceId = `security-device-${nanoid()}`;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET, "Security test");

  try {
    assert.equal(
      authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET).id,
      user.id,
    );
    assert.throws(
      () => authenticateOrCreateDeviceUserWithName(deviceId, WRONG_DEVICE_SECRET),
      /Device credential is invalid/,
    );
  } finally {
    deleteUserData(user.id);
  }
});

test("refresh tokens rotate once and reuse revokes the replacement family", () => {
  runMigrations();
  const deviceId = `refresh-device-${nanoid()}`;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET);

  try {
    const initial = createSession(user);
    const rotated = refreshSession(initial.refreshToken);
    assert.notEqual(rotated.refreshToken, initial.refreshToken);
    assert.throws(() => refreshSession(initial.refreshToken), /reuse detected/);
    assert.throws(() => refreshSession(rotated.refreshToken), /invalid or expired/);
  } finally {
    deleteUserData(user.id);
  }
});

test("pairing codes are cryptographic, expiring, and consumed exactly once", () => {
  runMigrations();
  const deviceId = `transfer-device-${nanoid()}`;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET);

  try {
    const transfer = createTransferToken(user.id);
    assert.match(transfer.token, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(new Date(transfer.expiresAt).getTime() > Date.now());
    assert.ok(new Date(transfer.expiresAt).getTime() <= Date.now() + 11 * 60 * 1_000);

    const linkedSession = consumeTransferToken(transfer.token);
    assert.equal(linkedSession.user.id, user.id);
    assert.throws(
      () => consumeTransferToken(transfer.token),
      /does not exist or is no longer valid/,
    );
  } finally {
    deleteUserData(user.id);
  }
});

function deleteUserData(userId: string) {
  db.prepare("DELETE FROM client_diagnostics WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM countdowns WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM debts WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM transactions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM budgets WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM categories WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM transfer_tokens WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}
