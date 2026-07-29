import type {
  AuthResponse,
  Budget,
  BudgetUpsertInput,
  Category,
  ClientDiagnosticInput,
  ClientDiagnosticResponse,
  Countdown,
  CountdownUpsertInput,
  ConsumeTransferTokenInput,
  CreateCategoryInput,
  CreateDebtInput,
  CreateTransactionInput,
  Debt,
  ImportDeviceDataInput,
  ImportDeviceDataResult,
  MonthlyReport,
  OwnDeviceDataResult,
  ProfileSlot,
  TransferTokenResponse,
  Transaction,
  UpdateDebtInput,
  UpdateUserPreferencesInput,
} from "@spending-tracker/shared";
import { ensureDeviceCredentials, ensureDeviceId, getLocalDeviceLabel } from "./device";
import { sessionStore } from "../state/session";

// Expo replaces direct EXPO_PUBLIC_* references while building the web bundle.
// Do not wrap this in a runtime `process` check: static hosts such as GitHub
// Pages have no process environment after the bundle is loaded.
const publicApiUrl = process.env.EXPO_PUBLIC_API_URL;
export const apiUrl = String(
  publicApiUrl ??
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:4000`
      : "http://localhost:4000"),
);

export const realtimeUrl = apiUrl.replace(/^http/i, "ws");

let refreshPromise: Promise<string | null> | null = null;

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("network") || message.includes("fetch") || message.includes("abort");
}

async function refreshStoredToken(refreshToken: string) {
  const response = await fetch(`${apiUrl}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken, ...(await ensureDeviceCredentials()) }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Refresh token failed (${response.status})`);
  }

  return (await response.json()) as AuthResponse;
}

async function restoreFromSavedProfile() {
  const state = sessionStore.getState();
  const slot = (state.activeProfile ?? "device") as ProfileSlot;

  if (slot === "linked") {
    const linkedProfile = state.linkedProfiles.find((profile) => profile.user.id === state.activeLinkedProfileUserId);
    const pairingCode = linkedProfile?.pairingCode;
    if (!pairingCode) {
      return null;
    }

    const response = await fetch(`${apiUrl}/auth/transfer-consume`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pairingCode, deviceId: await ensureDeviceId() }),
    });
    if (!response.ok) {
      return null;
    }

    const session = (await response.json()) as AuthResponse;
    sessionStore.getState().setSession(session, "linked", pairingCode);
    return session;
  }

  const deviceCredential = await ensureDeviceCredentials();
  const response = await fetch(`${apiUrl}/auth/device`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...deviceCredential, deviceName: await getLocalDeviceLabel() }),
  });
  if (!response.ok) {
    return null;
  }

  const session = (await response.json()) as AuthResponse;
  sessionStore.getState().setSession(session, "device");
  return session;
}

async function restorePersistedSession() {
  const state = sessionStore.getState();
  if (!state.refreshToken) {
    state.clearSession();
    return null;
  }

  try {
    const session = await refreshStoredToken(state.refreshToken);
    state.setSession(session, (state.activeProfile ?? "device") as ProfileSlot);
    return session;
  } catch (error) {
    if (isNetworkError(error)) {
      throw error;
    }
  }

  try {
    const session = await restoreFromSavedProfile();
    if (session) {
      return session;
    }
  } catch (error) {
    if (isNetworkError(error)) {
      throw error;
    }
  }

  const latest = sessionStore.getState();
  if (latest.activeProfile === "linked" && latest.activeLinkedProfileUserId) {
    latest.markLinkedProfileStale(latest.activeLinkedProfileUserId);
  }
  latest.clearSession();
  return null;
}

async function performRequest(path: string, init?: RequestInit) {
  const token = sessionStore.getState().accessToken;
  return fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const session = await restorePersistedSession();
    return session?.accessToken ?? null;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const response = await performRequest(path, init);

  if (response.status === 401 && retry && path !== "/auth/refresh") {
    const token = await refreshAccessToken();
    if (token) {
      return request<T>(path, init, false);
    }
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  signInWithDevice: async () => {
    const deviceCredential = await ensureDeviceCredentials();
    return request<AuthResponse>("/auth/device", {
      method: "POST",
      body: JSON.stringify({ ...deviceCredential, deviceName: await getLocalDeviceLabel() }),
    });
  },
  signInWithGoogle: async (idToken: string) =>
    request<AuthResponse>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken, deviceId: await ensureDeviceId() }),
    }),
  createTransferToken: () =>
    request<TransferTokenResponse>("/auth/transfer-token", {
      method: "POST",
    }),
  regenerateTransferToken: () =>
    request<TransferTokenResponse>("/auth/transfer-token/regenerate", {
      method: "POST",
    }),
  consumeTransferToken: async (input: ConsumeTransferTokenInput) =>
    request<AuthResponse>("/auth/transfer-consume", {
      method: "POST",
      body: JSON.stringify({ ...input, deviceId: await ensureDeviceId() }),
    }),
  refreshToken: refreshStoredToken,
  restorePersistedSession,
  me: () => request<{ user: AuthResponse["user"] }>("/me"),
  updateMe: (input: UpdateUserPreferencesInput) =>
    request<{ user: AuthResponse["user"] }>("/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  submitClientDiagnostic: (input: ClientDiagnosticInput) =>
    request<ClientDiagnosticResponse>("/diagnostics/client", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  importDeviceData: async (input: Omit<ImportDeviceDataInput, "deviceId">) =>
    request<ImportDeviceDataResult>("/auth/import-device-data", {
      method: "POST",
      body: JSON.stringify({ ...input, deviceId: await ensureDeviceId() }),
    }),
  ownDeviceData: async () =>
    request<OwnDeviceDataResult>("/auth/own-device-data", {
      method: "POST",
      body: JSON.stringify({ deviceId: await ensureDeviceId() }),
    }),
  categories: () => request<Category[]>("/categories"),
  createCategory: (input: CreateCategoryInput) =>
    request<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCategory: (id: string, input: Partial<CreateCategoryInput> & { archived?: boolean }) =>
    request<Category>(`/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCategory: (id: string) =>
    request<Category>(`/categories/${id}`, {
      method: "DELETE",
    }),
  transactions: (query?: Record<string, string>) => {
    const search = new URLSearchParams(query ?? {}).toString();
    return request<Transaction[]>(`/transactions${search ? `?${search}` : ""}`);
  },
  createTransaction: (input: CreateTransactionInput) =>
    request<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTransaction: (id: string, input: Partial<CreateTransactionInput>) =>
    request<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteTransaction: (id: string) =>
    request<void>(`/transactions/${id}`, {
      method: "DELETE",
    }),
  debts: () => request<Debt[]>("/debts"),
  createDebt: (input: CreateDebtInput) =>
    request<Debt>("/debts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateDebt: (id: string, input: UpdateDebtInput) =>
    request<Debt>(`/debts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteDebt: (id: string) =>
    request<void>(`/debts/${id}`, {
      method: "DELETE",
    }),
  countdown: () => request<Countdown | null>("/countdown"),
  upsertCountdown: (input: CountdownUpsertInput) =>
    request<Countdown>("/countdown", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteCountdown: () =>
    request<void>("/countdown", {
      method: "DELETE",
    }),
  budgets: (month: string) => request<Budget[]>(`/budgets?month=${month}`),
  upsertBudget: (input: BudgetUpsertInput) =>
    request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  monthlyReport: (month: string) =>
    request<MonthlyReport>(`/reports/monthly?month=${month}`),
};
