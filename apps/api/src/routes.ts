import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  assertDeviceCredential,
  authenticateOrCreateDeviceUserWithName,
  consumeTransferToken,
  createSession,
  createTransferToken,
  deviceUserExists,
  enrollLegacyDeviceCredential,
  findOrCreateUser,
  regenerateTransferToken,
  refreshSession,
  updateUserPreferences,
  verifyGoogleToken,
} from "./auth";
import { config } from "./config";
import { HttpError } from "./http-error";
import { requireAuth } from "./middleware/auth";
import {
  createCategory,
  createClientDiagnostic,
  createDebt,
  createTransaction,
  deleteCategory,
  deleteCountdown,
  deleteDebt,
  deleteTransaction,
  getBudgets,
  getCategories,
  getCountdown,
  getDebts,
  getMonthlyReport,
  getTransactions,
  importDeviceData,
  ownDeviceData,
  updateCategory,
  updateDebt,
  updateTransaction,
  upsertBudget,
  upsertCountdown,
} from "./repositories";
import { notifyUser } from "./realtime";
import { FixedWindowRateLimiter } from "./security-limits";

export const router = Router();
const deviceRegistrationLimiter = new FixedWindowRateLimiter(
  config.deviceRegistrationsPerWindow,
  config.deviceRegistrationWindowMinutes * 60 * 1_000,
);
const transferAttemptLimiter = new FixedWindowRateLimiter(
  config.transferAttemptsPerWindow,
  config.transferAttemptWindowMinutes * 60 * 1_000,
);
const diagnosticLimiter = new FixedWindowRateLimiter(
  config.diagnosticReportsPerWindow,
  config.diagnosticWindowMinutes * 60 * 1_000,
);

function currentUser(request: Request) {
  if (!request.user) {
    throw new Error("Authenticated user missing from request");
  }
  return request.user;
}

function first(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function requestedDeviceCredential(request: Request) {
  const deviceId =
    typeof request.body?.deviceId === "string" && request.body.deviceId.trim()
      ? request.body.deviceId.trim()
      : null;
  const deviceSecret =
    typeof request.body?.deviceSecret === "string" && request.body.deviceSecret
      ? request.body.deviceSecret
      : null;
  return { deviceId, deviceSecret };
}

function enforceRateLimit(
  response: Response,
  limiter: FixedWindowRateLimiter,
  key: string,
) {
  const result = limiter.consume(key);
  if (result.allowed) {
    return;
  }
  response.setHeader("Retry-After", String(result.retryAfterSeconds));
  throw new HttpError(429, "Too many attempts; try again later");
}

router.get("/health", (_request, response) => {
  response.json({ ok: true });
});

router.post("/auth/device", (request, response) => {
  const credential = requestedDeviceCredential(request);
  const deviceId = credential.deviceId ?? randomUUID();
  if (!credential.deviceSecret) {
    throw new HttpError(400, "Device credential is required");
  }
  if (!deviceUserExists(deviceId)) {
    enforceRateLimit(response, deviceRegistrationLimiter, request.ip ?? "unknown");
  }
  const deviceName =
    typeof request.body?.deviceName === "string" && request.body.deviceName.trim()
      ? request.body.deviceName.trim()
      : null;
  const user = authenticateOrCreateDeviceUserWithName(deviceId, credential.deviceSecret, deviceName);
  response.json(createSession(user));
});

router.post("/auth/google", async (request, response) => {
  try {
    const identity = await verifyGoogleToken(String(request.body.idToken ?? ""));
    const credential = requestedDeviceCredential(request);
    if (credential.deviceId && credential.deviceSecret) {
      assertDeviceCredential(credential.deviceId, credential.deviceSecret);
    }
    const deviceId = credential.deviceId && credential.deviceSecret ? credential.deviceId : null;
    const user = findOrCreateUser(identity, deviceId);
    response.json(createSession(user));
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }
    response.status(400).json({
      message: error instanceof Error ? error.message : "Google authentication failed",
    });
  }
});

router.post("/auth/refresh", (request, response) => {
  try {
    const session = refreshSession(String(request.body.refreshToken ?? ""));
    const credential = requestedDeviceCredential(request);
    enrollLegacyDeviceCredential(session.user, credential.deviceId, credential.deviceSecret);
    response.json(session);
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : "Refresh token failed",
    });
  }
});

router.post("/auth/transfer-consume", (request, response) => {
  try {
    enforceRateLimit(response, transferAttemptLimiter, request.ip ?? "unknown");
    const session = consumeTransferToken(String(request.body.token ?? ""));
    response.json(session);
  } catch (error) {
    if (error instanceof HttpError) {
      response.status(error.status).json({ message: error.message });
      return;
    }
    response.status(400).json({
      message: error instanceof Error ? error.message : "Transfer failed",
    });
  }
});

router.get("/me", requireAuth, (request, response) => {
  response.json({ user: currentUser(request) });
});

router.patch("/me", requireAuth, (request, response) => {
  const user = currentUser(request);
  const updated = updateUserPreferences(user.id, request.body);
  notifyUser(user.id, ["me"]);
  response.json({ user: updated });
});

router.post("/diagnostics/client", requireAuth, (request, response) => {
  enforceRateLimit(response, diagnosticLimiter, currentUser(request).id);
  const result = createClientDiagnostic(currentUser(request).id, request.body, {
    remoteAddress: request.ip,
    userAgent: request.get("user-agent") ?? null,
    acceptLanguage: request.get("accept-language") ?? null,
    origin: request.get("origin") ?? null,
    forwardedProto: request.get("x-forwarded-proto") ?? null,
  });
  response.status(201).json(result);
});

router.post("/auth/transfer-token", requireAuth, (request, response) => {
  response.json(createTransferToken(currentUser(request).id));
});

router.post("/auth/transfer-token/regenerate", requireAuth, (request, response) => {
  const user = currentUser(request);
  response.json(regenerateTransferToken(user.id));
});

router.post("/auth/import-device-data", requireAuth, (request, response) => {
  const user = currentUser(request);
  const credential = requestedDeviceCredential(request);
  if (!credential.deviceId || !credential.deviceSecret) {
    throw new HttpError(401, "Device credential is required");
  }
  assertDeviceCredential(credential.deviceId, credential.deviceSecret);
  const result = importDeviceData(user.id, request.body);
  notifyUser(user.id, ["categories", "transactions", "budgets", "debts", "countdown", "report", "reports"]);
  response.json(result);
});

router.post("/auth/own-device-data", requireAuth, (request, response) => {
  const user = currentUser(request);
  const credential = requestedDeviceCredential(request);
  if (!credential.deviceId || !credential.deviceSecret) {
    throw new HttpError(401, "Device credential is required");
  }
  assertDeviceCredential(credential.deviceId, credential.deviceSecret);
  const result = ownDeviceData(user.id, request.body);
  notifyUser(result.deviceUser.id, ["categories", "transactions", "budgets", "debts", "countdown", "report", "reports", "me"]);
  response.json(result);
});

router.get("/categories", requireAuth, (request, response) => {
  response.json(getCategories(currentUser(request).id));
});

router.post("/categories", requireAuth, (request, response) => {
  const user = currentUser(request);
  const category = createCategory(user.id, request.body);
  notifyUser(user.id, ["categories", "transactions", "debts", "report", "reports", "budgets"]);
  response.status(201).json(category);
});

router.patch("/categories/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  const category = updateCategory(user.id, first(request.params.id), request.body);
  notifyUser(user.id, ["categories", "transactions", "debts", "report", "reports", "budgets"]);
  response.json(category);
});

router.delete("/categories/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  const category = deleteCategory(user.id, first(request.params.id));
  notifyUser(user.id, ["categories", "transactions", "debts", "report", "reports", "budgets"]);
  response.json(category);
});

router.get("/transactions", requireAuth, (request, response) => {
  response.json(getTransactions(currentUser(request).id, request.query));
});

router.post("/transactions", requireAuth, (request, response) => {
  const user = currentUser(request);
  const transaction = createTransaction(user.id, request.body);
  notifyUser(user.id, ["transactions", "report", "reports"]);
  response.status(201).json(transaction);
});

router.patch("/transactions/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  const transaction = updateTransaction(user.id, first(request.params.id), request.body);
  notifyUser(user.id, ["transactions", "report", "reports"]);
  response.json(transaction);
});

router.delete("/transactions/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  deleteTransaction(user.id, first(request.params.id));
  notifyUser(user.id, ["transactions", "report", "reports"]);
  response.status(204).send();
});

router.get("/debts", requireAuth, (request, response) => {
  response.json(getDebts(currentUser(request).id));
});

router.post("/debts", requireAuth, (request, response) => {
  const user = currentUser(request);
  const debt = createDebt(user.id, request.body);
  notifyUser(user.id, ["debts"]);
  response.status(201).json(debt);
});

router.patch("/debts/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  const debt = updateDebt(user.id, first(request.params.id), request.body);
  notifyUser(user.id, ["debts"]);
  response.json(debt);
});

router.delete("/debts/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  deleteDebt(user.id, first(request.params.id));
  notifyUser(user.id, ["debts"]);
  response.status(204).send();
});

router.get("/countdown", requireAuth, (request, response) => {
  response.json(getCountdown(currentUser(request).id));
});

router.put("/countdown", requireAuth, (request, response) => {
  const user = currentUser(request);
  const countdown = upsertCountdown(user.id, request.body);
  notifyUser(user.id, ["countdown"]);
  response.json(countdown);
});

router.delete("/countdown", requireAuth, (request, response) => {
  const user = currentUser(request);
  deleteCountdown(user.id);
  notifyUser(user.id, ["countdown"]);
  response.status(204).send();
});

router.get("/budgets", requireAuth, (request, response) => {
  response.json(getBudgets(currentUser(request).id, first(request.query.month)));
});

router.post("/budgets", requireAuth, (request, response) => {
  const user = currentUser(request);
  const budget = upsertBudget(user.id, request.body);
  notifyUser(user.id, ["budgets", "report", "reports"]);
  response.status(201).json(budget);
});

router.put("/budgets/:id", requireAuth, (request, response) => {
  const user = currentUser(request);
  const budget = upsertBudget(user.id, { ...request.body, id: first(request.params.id) });
  notifyUser(user.id, ["budgets", "report", "reports"]);
  response.json(budget);
});

router.get("/reports/monthly", requireAuth, (request, response) => {
  response.json(getMonthlyReport(currentUser(request).id, first(request.query.month)));
});
