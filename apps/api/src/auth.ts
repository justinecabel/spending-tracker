import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  authResponseSchema,
  transferTokenResponseSchema,
  type UpdateUserPreferencesInput,
  updateUserPreferencesInputSchema,
  type User,
} from "@spending-tracker/shared";
import { config } from "./config";
import { db } from "./db/client";
import { HttpError } from "./http-error";

const googleClient = new OAuth2Client(config.googleClientId || undefined);
const SYNC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_SECRET_MIN_LENGTH = 32;

export async function verifyGoogleToken(idToken: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.googleClientId || undefined,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.name) {
    throw new Error("Invalid Google identity payload");
  }

  return {
    googleSub: payload.sub,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.picture ?? null,
  };
}

export function findOrCreateUser(identity: {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}, deviceId?: string | null) {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT * FROM users WHERE google_sub = ?")
    .get(identity.googleSub) as DatabaseUserRow | undefined;
  const deviceUser = !existing && deviceId
    ? (db.prepare("SELECT * FROM users WHERE device_id = ?").get(deviceId) as DatabaseUserRow | undefined)
    : undefined;
  const target = existing ?? deviceUser;

  if (target) {
    db.prepare(
      `
        UPDATE users
        SET email = @email, name = @name, avatar_url = @avatarUrl, google_sub = @googleSub, device_id = COALESCE(@deviceId, device_id), is_device_only = 0, last_seen_at = @lastSeenAt, updated_at = @updatedAt
        WHERE id = @id
      `,
    ).run({
      id: target.id,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      googleSub: identity.googleSub,
      deviceId: deviceId ?? null,
      lastSeenAt: now,
      updatedAt: now,
    });

    return hydrateUser({
      ...target,
      email: identity.email,
      name: identity.name,
      avatar_url: identity.avatarUrl,
      google_sub: identity.googleSub,
      device_id: deviceId ?? target.device_id ?? null,
      is_device_only: 0,
      last_seen_at: now,
      updated_at: now,
    });
  }

  const id = nanoid();
  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (@id, @email, @name, @avatarUrl, @googleSub, @deviceId, 0, 'USD', @lastSeenAt, @createdAt, @updatedAt)
    `,
  ).run({
    id,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    googleSub: identity.googleSub,
    deviceId: deviceId ?? null,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });

  seedDefaultCategories(id, now);

  return {
    id,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    googleSub: identity.googleSub,
    deviceId: deviceId ?? null,
    isDeviceOnly: false,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
  } satisfies User;
}

export function deviceUserExists(deviceId: string) {
  return Boolean(db.prepare("SELECT id FROM users WHERE device_id = ?").get(deviceId));
}

export function authenticateOrCreateDeviceUserWithName(
  deviceId: string,
  deviceSecret: string,
  deviceName?: string | null,
) {
  validateDeviceCredentialInput(deviceId, deviceSecret);
  const existing = db.prepare("SELECT * FROM users WHERE device_id = ?").get(deviceId) as DatabaseUserRow | undefined;
  if (existing) {
    if (!existing.device_secret_hash || !matchesDeviceSecret(deviceSecret, existing.device_secret_hash)) {
      throw new HttpError(401, "Device credential is invalid");
    }
    if (deviceName && existing.name !== deviceName) {
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(deviceName, updatedAt, existing.id);
      return hydrateUser({
        ...existing,
        name: deviceName,
        updated_at: updatedAt,
      });
    }
    return hydrateUser(existing);
  }

  const deviceAccountCount = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE is_device_only = 1")
    .get() as { count: number };
  if (deviceAccountCount.count >= config.maxDeviceAccounts) {
    throw new HttpError(429, "Device account capacity has been reached");
  }

  const now = new Date().toISOString();
  const id = nanoid();
  const placeholderEmail = `device-${deviceId}@device.local`;
  const placeholderGoogleSub = `device:${deviceId}`;
  const resolvedDeviceName = deviceName?.trim() || "This device";

  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, device_secret_hash, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (@id, @email, @name, NULL, @googleSub, @deviceId, @deviceSecretHash, 1, 'USD', @lastSeenAt, @createdAt, @updatedAt)
    `,
  ).run({
    id,
    email: placeholderEmail,
    name: resolvedDeviceName,
    googleSub: placeholderGoogleSub,
    deviceId,
    deviceSecretHash: hashDeviceSecret(deviceSecret),
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });

  seedDefaultCategories(id, now);

  return hydrateUser({
    id,
    email: placeholderEmail,
    name: resolvedDeviceName,
    avatar_url: null,
    google_sub: placeholderGoogleSub,
    device_id: deviceId,
    device_secret_hash: hashDeviceSecret(deviceSecret),
    sync_code: null,
    is_device_only: 1,
    currency: "USD",
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });
}

export function assertDeviceCredential(deviceId: string, deviceSecret: string) {
  validateDeviceCredentialInput(deviceId, deviceSecret);
  const row = db
    .prepare("SELECT device_secret_hash FROM users WHERE device_id = ? AND is_device_only = 1")
    .get(deviceId) as { device_secret_hash: string | null } | undefined;
  if (!row?.device_secret_hash || !matchesDeviceSecret(deviceSecret, row.device_secret_hash)) {
    throw new HttpError(401, "Device credential is invalid");
  }
}

export function enrollLegacyDeviceCredential(
  user: User,
  deviceId: string | null | undefined,
  deviceSecret: string | null | undefined,
) {
  if (!user.isDeviceOnly || !user.deviceId || user.deviceId !== deviceId || !deviceSecret) {
    return;
  }
  validateDeviceCredentialInput(deviceId, deviceSecret);
  db.prepare(
    "UPDATE users SET device_secret_hash = ? WHERE id = ? AND device_secret_hash IS NULL",
  ).run(hashDeviceSecret(deviceSecret), user.id);
}

export function createSession(user: User, options: { familyId?: string } = {}) {
  touchUser(user.id);
  const accessToken = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: "1h" });
  const refreshToken = nanoid(48);
  const refreshTokenId = nanoid();
  const familyId = options.familyId ?? refreshTokenId;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();

  db.prepare(
    `
      INSERT INTO refresh_tokens (id, user_id, token, created_at, expires_at, used_at, family_id)
      VALUES (@id, @userId, @token, @createdAt, @expiresAt, NULL, @familyId)
    `,
  ).run({
    id: refreshTokenId,
    userId: user.id,
    token: refreshToken,
    createdAt: now.toISOString(),
    expiresAt,
    familyId,
  });

  return authResponseSchema.parse({
    user,
    accessToken,
    refreshToken,
  });
}

export function refreshSession(token: string) {
  let result: ReturnType<typeof createSession> | null = null;
  let failure: Error | null = null;
  const now = new Date();

  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `
          SELECT
            refresh_tokens.id AS refresh_token_id,
            refresh_tokens.expires_at AS refresh_expires_at,
            refresh_tokens.used_at AS refresh_used_at,
            refresh_tokens.family_id AS refresh_family_id,
            users.*
          FROM refresh_tokens
          JOIN users ON users.id = refresh_tokens.user_id
          WHERE refresh_tokens.token = ?
        `,
      )
      .get(token) as RefreshSessionRow | undefined;

    if (!row) {
      failure = new Error("Refresh token is invalid or expired");
    } else if (row.refresh_used_at) {
      db.prepare("DELETE FROM refresh_tokens WHERE family_id = ?").run(row.refresh_family_id);
      failure = new Error("Refresh token reuse detected; this session family was revoked");
    } else if (new Date(row.refresh_expires_at).getTime() < now.getTime()) {
      db.prepare("DELETE FROM refresh_tokens WHERE id = ?").run(row.refresh_token_id);
      failure = new Error("Refresh token is invalid or expired");
    } else {
      const consumed = db
        .prepare("UPDATE refresh_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL")
        .run(now.toISOString(), row.refresh_token_id);
      if (consumed.changes !== 1) {
        failure = new Error("Refresh token is invalid or expired");
      } else {
        result = createSession(hydrateUser(row), {
          familyId: row.refresh_family_id ?? row.refresh_token_id,
        });
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  if (failure) {
    throw failure;
  }
  if (!result) {
    throw new Error("Refresh token rotation failed");
  }
  return result;
}

export function createTransferToken(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DatabaseUserRow | undefined;
  if (!user) {
    throw new Error("User not found");
  }

  const now = new Date();
  const active = db
    .prepare(
      `
        SELECT token, expires_at
        FROM transfer_tokens
        WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .get(userId, now.toISOString()) as { token: string; expires_at: string } | undefined;

  if (active) {
    return transferTokenResponseSchema.parse({
      token: active.token,
      pairingCode: active.token,
      expiresAt: active.expires_at,
      qrValue: active.token,
    });
  }

  const token = allocateSyncCode();
  const expiresAt = new Date(
    now.getTime() + config.transferTokenLifetimeMinutes * 60 * 1_000,
  ).toISOString();
  db.prepare(
    `
      INSERT INTO transfer_tokens (id, user_id, token, created_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `,
  ).run(nanoid(), userId, token, now.toISOString(), expiresAt);

  return transferTokenResponseSchema.parse({
    token,
    pairingCode: token,
    expiresAt,
    qrValue: token,
  });
}

export function regenerateTransferToken(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DatabaseUserRow | undefined;
  if (!user) {
    throw new Error("User not found");
  }

  db.prepare(
    "UPDATE transfer_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
  ).run(new Date().toISOString(), userId);
  return createTransferToken(userId);
}

export function consumeTransferToken(rawToken: string) {
  const token = extractTransferToken(rawToken);
  let result: ReturnType<typeof createSession> | null = null;
  let failure: Error | null = null;
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `
          SELECT transfer_tokens.id AS transfer_token_id, transfer_tokens.expires_at AS transfer_expires_at, users.*
          FROM transfer_tokens
          JOIN users ON users.id = transfer_tokens.user_id
          WHERE transfer_tokens.token = ? AND transfer_tokens.used_at IS NULL
        `,
      )
      .get(token) as TransferSessionRow | undefined;

    if (!row || row.transfer_expires_at <= now) {
      failure = new Error("This pairing code does not exist or is no longer valid");
    } else {
      const consumed = db
        .prepare("UPDATE transfer_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL")
        .run(now, row.transfer_token_id);
      if (consumed.changes !== 1) {
        failure = new Error("This pairing code does not exist or is no longer valid");
      } else {
        result = createSession(hydrateUser(row));
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  if (failure) {
    throw failure;
  }
  if (!result) {
    throw new Error("Pairing code consumption failed");
  }
  return result;
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as DatabaseUserRow | undefined;
  if (!user) {
    throw new Error("User not found");
  }
  touchUser(user.id);
  return hydrateUser(user);
}

export type CleanupOptions = {
  database?: DatabaseSync;
  now?: Date;
  emptyAccountGraceHours?: number;
  inactiveAccountRetentionMonths?: number;
};

export function pruneStaleData(options: CleanupOptions = {}) {
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const emptyAccountGraceHours = options.emptyAccountGraceHours ?? config.emptyAccountGraceHours;
  const inactiveAccountRetentionMonths = options.inactiveAccountRetentionMonths ?? config.inactiveAccountRetentionMonths;
  const emptyAccountBefore = new Date(now.getTime() - emptyAccountGraceHours * 60 * 60 * 1000).toISOString();
  const inactiveAccountBefore = subtractCalendarMonths(now, inactiveAccountRetentionMonths).toISOString();
  const nowIso = now.toISOString();

  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(nowIso);
    database.prepare("DELETE FROM transfer_tokens WHERE expires_at < ? OR used_at IS NOT NULL").run(nowIso);
    const diagnosticCutoff = new Date(
      now.getTime() - config.diagnosticRetentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    database.prepare("DELETE FROM client_diagnostics WHERE created_at < ?").run(diagnosticCutoff);

    const staleUsers = database
      .prepare(
        `
          SELECT id
          FROM users
          WHERE (
            created_at <= @emptyAccountBefore
            AND NOT EXISTS (
              SELECT 1
              FROM transactions
              WHERE transactions.user_id = users.id AND transactions.deleted_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1
              FROM debts
              WHERE debts.user_id = users.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM countdowns
              WHERE countdowns.user_id = users.id
            )
          )
          OR (
            last_seen_at <= @inactiveAccountBefore
            AND EXISTS (
              SELECT 1 FROM transactions
              WHERE transactions.user_id = users.id AND transactions.deleted_at IS NULL
              UNION ALL
              SELECT 1 FROM debts
              WHERE debts.user_id = users.id
              UNION ALL
              SELECT 1 FROM countdowns
              WHERE countdowns.user_id = users.id
            )
          )
        `,
      )
      .all({ emptyAccountBefore, inactiveAccountBefore }) as Array<{ id: string }>;

    let deletedUsers = 0;
    for (const { id } of staleUsers) {
      database.exec("SAVEPOINT cleanup_user");
      try {
        database.prepare("DELETE FROM client_diagnostics WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM countdowns WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM debts WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM transactions WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM budgets WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM categories WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM transfer_tokens WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM users WHERE id = ?").run(id);
        database.exec("RELEASE cleanup_user");
        deletedUsers += 1;
      } catch {
        database.exec("ROLLBACK TO cleanup_user");
        database.exec("RELEASE cleanup_user");
      }
    }

    database.exec("COMMIT");
    return deletedUsers;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function subtractCalendarMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function extractTransferToken(value: string) {
  return value.trim().toUpperCase();
}

export function updateUserPreferences(userId: string, input: UpdateUserPreferencesInput) {
  const parsed = updateUserPreferencesInputSchema.parse(input);
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DatabaseUserRow | undefined;

  if (!current) {
    throw new Error("User not found");
  }

  const updated: DatabaseUserRow = {
    ...current,
    currency: parsed.currency,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `
      UPDATE users
      SET currency = @currency, updated_at = @updated_at
      WHERE id = @id
    `,
  ).run({
    id: updated.id,
    currency: updated.currency,
    updated_at: updated.updated_at,
  });

  return hydrateUser(updated);
}

function hydrateUser(row: DatabaseUserRow): User {
  return {
    id: row.id,
    email: row.is_device_only ? null : row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    googleSub: row.is_device_only ? null : row.google_sub,
    deviceId: row.device_id,
    isDeviceOnly: Boolean(row.is_device_only),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function touchUser(userId: string) {
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?").run(now, now, userId);
}

function allocateSyncCode() {
  let code = "";

  do {
    code = makeSyncCode();
  } while (
    db.prepare("SELECT id FROM transfer_tokens WHERE token = ?").get(code) as { id: string } | undefined
  );

  return code;
}

function makeSyncCode() {
  return `${randomCodeChunk(4)}-${randomCodeChunk(4)}`;
}

function randomCodeChunk(length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const offset = randomInt(SYNC_CODE_ALPHABET.length);
    value += SYNC_CODE_ALPHABET[offset];
  }
  return value;
}

function validateDeviceCredentialInput(deviceId: string, deviceSecret: string) {
  if (!deviceId.trim() || deviceId.length > 200) {
    throw new HttpError(400, "Device ID is invalid");
  }
  if (deviceSecret.length < DEVICE_SECRET_MIN_LENGTH || deviceSecret.length > 256) {
    throw new HttpError(401, "Device credential is invalid");
  }
}

function hashDeviceSecret(deviceSecret: string) {
  return createHash("sha256").update(deviceSecret, "utf8").digest("hex");
}

function matchesDeviceSecret(deviceSecret: string, expectedHash: string) {
  const actual = Buffer.from(hashDeviceSecret(deviceSecret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function seedDefaultCategories(userId: string, now: string) {
  const defaults = [
    { name: "Food", kind: "expense", color: "#16A34A", icon: "utensils", isSystem: 0 },
    { name: "Transport", kind: "expense", color: "#2563EB", icon: "car", isSystem: 0 },
    { name: "Shopping", kind: "expense", color: "#D97706", icon: "bag", isSystem: 0 },
    { name: "Other", kind: "expense", color: "#475569", icon: "circle", isSystem: 1 },
    { name: "Trashed", kind: "expense", color: "#991B1B", icon: "archive", isSystem: 1 },
  ];

  for (const [index, category] of defaults.entries()) {
    db.prepare(
      `
        INSERT INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
        SELECT @id, @userId, @name, @kind, @color, @icon, @isSystem, @sortOrder, 0, @createdAt, @updatedAt
        WHERE NOT EXISTS (
          SELECT 1 FROM categories WHERE user_id = @userId AND LOWER(name) = LOWER(@name)
        )
      `,
    ).run({
      id: nanoid(),
      userId,
      name: category.name,
      kind: category.kind,
      color: category.color,
      icon: category.icon,
      isSystem: category.isSystem,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    });
  }
}

type DatabaseUserRow = {
  id: string;
  email: string | null;
  name: string;
  avatar_url: string | null;
  google_sub: string | null;
  device_id: string | null;
  device_secret_hash: string | null;
  sync_code: string | null;
  is_device_only: number;
  currency: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type RefreshSessionRow = DatabaseUserRow & {
  refresh_token_id: string;
  refresh_expires_at: string;
  refresh_used_at: string | null;
  refresh_family_id: string | null;
};

type TransferSessionRow = DatabaseUserRow & {
  transfer_token_id: string;
  transfer_expires_at: string;
};
