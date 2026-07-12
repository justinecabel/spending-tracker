import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import {
  authResponseSchema,
  transferTokenResponseSchema,
  type UpdateUserPreferencesInput,
  updateUserPreferencesInputSchema,
  type User,
} from "@spending-tracker/shared";
import { config } from "./config";
import { db } from "./db/client";

const googleClient = new OAuth2Client(config.googleClientId || undefined);
const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
const SYNC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

export function findOrCreateDeviceUser(deviceId: string) {
  return findOrCreateDeviceUserWithName(deviceId, null);
}

export function findOrCreateDeviceUserWithName(deviceId: string, deviceName?: string | null) {
  const existing = db.prepare("SELECT * FROM users WHERE device_id = ?").get(deviceId) as DatabaseUserRow | undefined;
  if (existing) {
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

  const now = new Date().toISOString();
  const id = nanoid();
  const placeholderEmail = `device-${deviceId}@device.local`;
  const placeholderGoogleSub = `device:${deviceId}`;
  const resolvedDeviceName = deviceName?.trim() || "This device";

  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (@id, @email, @name, NULL, @googleSub, @deviceId, 1, 'USD', @lastSeenAt, @createdAt, @updatedAt)
    `,
  ).run({
    id,
    email: placeholderEmail,
    name: resolvedDeviceName,
    googleSub: placeholderGoogleSub,
    deviceId,
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
    sync_code: null,
    is_device_only: 1,
    currency: "USD",
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });
}

export function createSession(user: User) {
  touchUser(user.id);
  const accessToken = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: "1h" });
  const refreshToken = nanoid(48);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();

  db.prepare(
    `
      INSERT INTO refresh_tokens (id, user_id, token, created_at, expires_at)
      VALUES (@id, @userId, @token, @createdAt, @expiresAt)
    `,
  ).run({
    id: nanoid(),
    userId: user.id,
    token: refreshToken,
    createdAt: now.toISOString(),
    expiresAt,
  });

  return authResponseSchema.parse({
    user,
    accessToken,
    refreshToken,
  });
}

export function refreshSession(token: string) {
  const row = db
    .prepare(
      `
        SELECT refresh_tokens.*, users.*
        FROM refresh_tokens
        JOIN users ON users.id = refresh_tokens.user_id
        WHERE refresh_tokens.token = ?
      `,
    )
    .get(token) as (RefreshTokenRow & DatabaseUserRow) | undefined;

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error("Refresh token is invalid or expired");
  }

  const user = hydrateUser(row);
  touchUser(user.id);
  return createSession(user);
}

export function createTransferToken(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DatabaseUserRow | undefined;
  if (!user) {
    throw new Error("User not found");
  }

  const token = user.sync_code ?? allocateSyncCode();
  if (!user.sync_code) {
    db.prepare("UPDATE users SET sync_code = ?, updated_at = ? WHERE id = ?").run(token, new Date().toISOString(), userId);
  }

  return transferTokenResponseSchema.parse({
    token,
    pairingCode: token,
    expiresAt: "9999-12-31T23:59:59.999Z",
    qrValue: token,
  });
}

export function regenerateTransferToken(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DatabaseUserRow | undefined;
  if (!user) {
    throw new Error("User not found");
  }

  const token = allocateSyncCode();
  db.prepare("UPDATE users SET sync_code = ?, updated_at = ? WHERE id = ?").run(token, new Date().toISOString(), userId);

  return transferTokenResponseSchema.parse({
    token,
    pairingCode: token,
    expiresAt: "9999-12-31T23:59:59.999Z",
    qrValue: token,
  });
}

export function consumeTransferToken(rawToken: string) {
  const token = extractTransferToken(rawToken);
  const row = db.prepare("SELECT * FROM users WHERE sync_code = ?").get(token) as DatabaseUserRow | undefined;

  if (!row) {
    throw new Error("This pairing code does not exist or is no longer valid");
  }

  return createSession(hydrateUser(row));
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

export function pruneStaleData() {
  const now = Date.now();
  const staleBefore = new Date(now - ONE_YEAR_MS).toISOString();

  db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(new Date(now).toISOString());
  db.prepare("DELETE FROM transfer_tokens WHERE expires_at < ? OR used_at IS NOT NULL").run(new Date(now).toISOString());

  const staleUsers = db
    .prepare("SELECT id FROM users WHERE last_seen_at < ?")
    .all(staleBefore) as Array<{ id: string }>;

  for (const { id } of staleUsers) {
    db.prepare("DELETE FROM transactions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM budgets WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM transfer_tokens WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }
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
    db.prepare("SELECT id FROM users WHERE sync_code = ?").get(code) as { id: string } | undefined
  );

  return code;
}

function makeSyncCode() {
  return `${randomCodeChunk(3)}-${randomCodeChunk(3)}`;
}

function randomCodeChunk(length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    const offset = Math.floor(Math.random() * SYNC_CODE_ALPHABET.length);
    value += SYNC_CODE_ALPHABET[offset];
  }
  return value;
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
  sync_code: string | null;
  is_device_only: number;
  currency: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type RefreshTokenRow = {
  expires_at: string;
};
