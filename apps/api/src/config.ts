import dotenv from "dotenv";
import { randomBytes } from "node:crypto";

dotenv.config();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveJwtSecret(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV ?? "development",
) {
  const normalized = value?.trim();
  const knownPlaceholders = new Set(["change-me", "replace-with-a-long-random-secret"]);

  if (normalized && normalized.length >= 32 && !knownPlaceholders.has(normalized)) {
    return normalized;
  }

  if (nodeEnv === "production") {
    throw new Error("JWT_SECRET must be a deployment-specific value of at least 32 characters");
  }

  return randomBytes(48).toString("base64url");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
  jwtSecret: resolveJwtSecret(process.env.JWT_SECRET),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  dbPath: process.env.DB_PATH ?? "./data/spending-tracker.sqlite",
  emptyAccountGraceHours: positiveInteger(process.env.EMPTY_ACCOUNT_GRACE_HOURS, 12),
  inactiveAccountRetentionMonths: positiveInteger(process.env.INACTIVE_ACCOUNT_RETENTION_MONTHS, 12),
  cleanupIntervalHours: positiveInteger(process.env.CLEANUP_INTERVAL_HOURS, 12),
  maxDeviceAccounts: positiveInteger(process.env.MAX_DEVICE_ACCOUNTS, 1_000),
  deviceRegistrationsPerWindow: positiveInteger(process.env.DEVICE_REGISTRATIONS_PER_WINDOW, 10),
  deviceRegistrationWindowMinutes: positiveInteger(process.env.DEVICE_REGISTRATION_WINDOW_MINUTES, 60),
  transferAttemptsPerWindow: positiveInteger(process.env.TRANSFER_ATTEMPTS_PER_WINDOW, 10),
  transferAttemptWindowMinutes: positiveInteger(process.env.TRANSFER_ATTEMPT_WINDOW_MINUTES, 15),
  transferTokenLifetimeMinutes: positiveInteger(process.env.TRANSFER_TOKEN_LIFETIME_MINUTES, 10),
  diagnosticReportsPerWindow: positiveInteger(process.env.DIAGNOSTIC_REPORTS_PER_WINDOW, 5),
  diagnosticWindowMinutes: positiveInteger(process.env.DIAGNOSTIC_WINDOW_MINUTES, 60),
  diagnosticRetentionDays: positiveInteger(process.env.DIAGNOSTIC_RETENTION_DAYS, 30),
  diagnosticMaxPerUser: positiveInteger(process.env.DIAGNOSTIC_MAX_PER_USER, 20),
  diagnosticMaxTotal: positiveInteger(process.env.DIAGNOSTIC_MAX_TOTAL, 1_000),
  websocketMaxPerUser: positiveInteger(process.env.WEBSOCKET_MAX_PER_USER, 5),
  websocketMaxTotal: positiveInteger(process.env.WEBSOCKET_MAX_TOTAL, 200),
  websocketMaxBufferedBytes: positiveInteger(process.env.WEBSOCKET_MAX_BUFFERED_BYTES, 262_144),
  websocketHeartbeatSeconds: positiveInteger(process.env.WEBSOCKET_HEARTBEAT_SECONDS, 30),
  websocketMaxLifetimeHours: positiveInteger(process.env.WEBSOCKET_MAX_LIFETIME_HOURS, 24),
};
