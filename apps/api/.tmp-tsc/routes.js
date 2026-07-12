import { randomUUID } from "node:crypto";
import { Router } from "express";
import { consumeTransferToken, createSession, createTransferToken, findOrCreateDeviceUserWithName, findOrCreateUser, regenerateTransferToken, refreshSession, updateUserPreferences, verifyGoogleToken, } from "./auth";
import { requireAuth } from "./middleware/auth";
import { createCategory, createTransaction, deleteCategory, deleteTransaction, getBudgets, getCategories, getMonthlyReport, getTransactions, importDeviceData, ownDeviceData, updateCategory, updateTransaction, upsertBudget, } from "./repositories";
import { notifyUser } from "./realtime";
export const router = Router();
const DEVICE_COOKIE_NAME = "spending_tracker_device";
function currentUser(request) {
    if (!request.user) {
        throw new Error("Authenticated user missing from request");
    }
    return request.user;
}
function first(value) {
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}
function cookieValue(request, name) {
    const header = request.headers.cookie;
    if (!header) {
        return null;
    }
    const entry = header
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}
function setDeviceCookie(response, deviceId) {
    response.cookie(DEVICE_COOKIE_NAME, deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 365,
        path: "/",
    });
}
function requestedDeviceId(request) {
    const explicitDeviceId = typeof request.body?.deviceId === "string" && request.body.deviceId.trim()
        ? request.body.deviceId.trim()
        : null;
    return explicitDeviceId ?? cookieValue(request, DEVICE_COOKIE_NAME);
}
router.get("/health", (_request, response) => {
    response.json({ ok: true });
});
router.post("/auth/device", (request, response) => {
    const deviceId = requestedDeviceId(request) ?? randomUUID();
    const deviceName = typeof request.body?.deviceName === "string" && request.body.deviceName.trim()
        ? request.body.deviceName.trim()
        : null;
    const user = findOrCreateDeviceUserWithName(deviceId, deviceName);
    setDeviceCookie(response, deviceId);
    response.json(createSession(user));
});
router.post("/auth/google", async (request, response) => {
    try {
        const identity = await verifyGoogleToken(String(request.body.idToken ?? ""));
        const deviceId = requestedDeviceId(request);
        const user = findOrCreateUser(identity, deviceId);
        if (deviceId) {
            setDeviceCookie(response, deviceId);
        }
        response.json(createSession(user));
    }
    catch (error) {
        response.status(400).json({
            message: error instanceof Error ? error.message : "Google authentication failed",
        });
    }
});
router.post("/auth/refresh", (request, response) => {
    try {
        const session = refreshSession(String(request.body.refreshToken ?? ""));
        if (session.user.deviceId) {
            setDeviceCookie(response, session.user.deviceId);
        }
        response.json(session);
    }
    catch (error) {
        response.status(401).json({
            message: error instanceof Error ? error.message : "Refresh token failed",
        });
    }
});
router.post("/auth/transfer-consume", (request, response) => {
    try {
        const session = consumeTransferToken(String(request.body.token ?? ""));
        const deviceId = requestedDeviceId(request);
        if (deviceId) {
            setDeviceCookie(response, deviceId);
        }
        response.json(session);
    }
    catch (error) {
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
router.post("/auth/transfer-token", requireAuth, (request, response) => {
    response.json(createTransferToken(currentUser(request).id));
});
router.post("/auth/transfer-token/regenerate", requireAuth, (request, response) => {
    const user = currentUser(request);
    response.json(regenerateTransferToken(user.id));
});
router.post("/auth/import-device-data", requireAuth, (request, response) => {
    const user = currentUser(request);
    const result = importDeviceData(user.id, request.body);
    notifyUser(user.id, ["categories", "transactions", "budgets", "report", "reports"]);
    response.json(result);
});
router.post("/auth/own-device-data", requireAuth, (request, response) => {
    const user = currentUser(request);
    const result = ownDeviceData(user.id, request.body);
    notifyUser(result.deviceUser.id, ["categories", "transactions", "budgets", "report", "reports", "me"]);
    response.json(result);
});
router.get("/categories", requireAuth, (request, response) => {
    response.json(getCategories(currentUser(request).id));
});
router.post("/categories", requireAuth, (request, response) => {
    const user = currentUser(request);
    const category = createCategory(user.id, request.body);
    notifyUser(user.id, ["categories", "transactions", "report", "reports", "budgets"]);
    response.status(201).json(category);
});
router.patch("/categories/:id", requireAuth, (request, response) => {
    const user = currentUser(request);
    const category = updateCategory(user.id, first(request.params.id), request.body);
    notifyUser(user.id, ["categories", "transactions", "report", "reports", "budgets"]);
    response.json(category);
});
router.delete("/categories/:id", requireAuth, (request, response) => {
    const user = currentUser(request);
    const category = deleteCategory(user.id, first(request.params.id));
    notifyUser(user.id, ["categories", "transactions", "report", "reports", "budgets"]);
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
