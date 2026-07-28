import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import {
  authenticateOrCreateDeviceUserWithName,
  consumeTransferToken,
  createSession,
  createTransferToken,
  regenerateTransferToken,
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

test("pairing codes are cryptographic, stable, and explicitly regeneratable", () => {
  runMigrations();
  const deviceId = `transfer-device-${nanoid()}`;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET);

  try {
    const transfer = createTransferToken(user.id);
    assert.match(transfer.token, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(transfer.expiresAt, "9999-12-31T23:59:59.999Z");

    const linkedSession = consumeTransferToken(transfer.token);
    assert.equal(linkedSession.user.id, user.id);
    assert.equal(consumeTransferToken(transfer.token).user.id, user.id);
    assert.equal(createTransferToken(user.id).token, transfer.token);

    const regenerated = regenerateTransferToken(user.id);
    assert.notEqual(regenerated.token, transfer.token);
    assert.throws(() => consumeTransferToken(transfer.token), /does not exist or is no longer valid/);
    assert.equal(consumeTransferToken(regenerated.token).user.id, user.id);
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
