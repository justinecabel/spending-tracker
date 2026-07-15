import dotenv from "dotenv";

dotenv.config();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:4000",
  jwtSecret: process.env.JWT_SECRET ?? "change-me",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  dbPath: process.env.DB_PATH ?? "./data/spending-tracker.sqlite",
  emptyAccountGraceHours: positiveInteger(process.env.EMPTY_ACCOUNT_GRACE_HOURS, 12),
  inactiveAccountRetentionMonths: positiveInteger(process.env.INACTIVE_ACCOUNT_RETENTION_MONTHS, 12),
  cleanupIntervalHours: positiveInteger(process.env.CLEANUP_INTERVAL_HOURS, 12),
};
