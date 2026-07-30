import assert from "node:assert/strict";
import { once } from "node:events";
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
import { app } from "../src/app";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

const DEVICE_SECRET = "a".repeat(43);
const WRONG_DEVICE_SECRET = "b".repeat(43);
const ENROLLED_DEVICE_SECRET = "c".repeat(43);

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

test("the device auth endpoint rejects a copied Device ID without its secret", async () => {
  runMigrations();
  const deviceId = `security-route-${nanoid()}`;
  let userId: string | null = null;

  try {
    await withApi(async (baseUrl) => {
      const registered = await postDeviceAuth(baseUrl, {
        deviceId,
        deviceSecret: DEVICE_SECRET,
        deviceName: "Security route test",
      });
      assert.equal(registered.status, 200);
      const registeredBody = (await registered.json()) as { user: { id: string } };
      userId = registeredBody.user.id;

      const copiedIdAttempt = await postDeviceAuth(baseUrl, {
        deviceId,
        deviceSecret: WRONG_DEVICE_SECRET,
      });
      assert.equal(copiedIdAttempt.status, 401);

      const missingSecretAttempt = await postDeviceAuth(baseUrl, { deviceId });
      assert.equal(missingSecretAttempt.status, 401);

      const legitimateRetry = await postDeviceAuth(baseUrl, {
        deviceId,
        deviceSecret: DEVICE_SECRET,
      });
      assert.equal(legitimateRetry.status, 200);
    });
  } finally {
    if (userId) {
      deleteUserData(userId);
    }
  }
});

test("an authenticated legacy device session enrolls a secret during refresh", () => {
  runMigrations();
  const deviceId = `legacy-device-${nanoid()}`;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, DEVICE_SECRET, "Legacy device");

  try {
    db.prepare("UPDATE users SET device_secret_hash = NULL WHERE id = ?").run(user.id);
    const initial = createSession(user);
    refreshSession(initial.refreshToken, {
      deviceId,
      deviceSecret: ENROLLED_DEVICE_SECRET,
    });

    assert.equal(
      authenticateOrCreateDeviceUserWithName(deviceId, ENROLLED_DEVICE_SECRET).id,
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
    assert.equal(refreshExpiry(linkedSession.refreshToken), transfer.expiresAt);
    const rotatedLinkedSession = refreshSession(linkedSession.refreshToken);
    assert.equal(refreshExpiry(rotatedLinkedSession.refreshToken), transfer.expiresAt);
    assert.equal(consumeTransferToken(transfer.token).user.id, user.id);
    assert.equal(createTransferToken(user.id).token, transfer.token);

    const session = createSession(user);
    refreshSession(session.refreshToken);
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

async function withApi(run: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test API did not expose a TCP address");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function postDeviceAuth(baseUrl: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function refreshExpiry(token: string) {
  const row = db
    .prepare("SELECT expires_at FROM refresh_tokens WHERE token = ?")
    .get(token) as { expires_at: string } | undefined;
  return row?.expires_at;
}
