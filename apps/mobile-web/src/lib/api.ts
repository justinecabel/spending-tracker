import type {
  AuthResponse,
  AiPredictionRequest,
  AiPredictionResponse,
  Budget,
  BudgetUpsertInput,
  Category,
  ConsumeTransferTokenInput,
  CreateCategoryInput,
  CreateTransactionInput,
  ImportDeviceDataInput,
  ImportDeviceDataResult,
  MonthlyReport,
  OwnDeviceDataResult,
  ProfileSlot,
  TransferTokenResponse,
  Transaction,
  UpdateUserPreferencesInput,
} from "@spending-tracker/shared";
import { ensureDeviceId, getLocalDeviceLabel } from "./device";
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
    const { refreshToken, activeProfile } = sessionStore.getState();
    if (!refreshToken) {
      sessionStore.getState().clearSession();
      return null;
    }

    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      sessionStore.getState().clearSession();
      return null;
    }

    const session = (await response.json()) as AuthResponse;
    sessionStore.getState().setSession(session, (activeProfile ?? "device") as ProfileSlot);
    return session.accessToken;
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
  signInWithDevice: async () =>
    request<AuthResponse>("/auth/device", {
      method: "POST",
      body: JSON.stringify({ deviceId: await ensureDeviceId(), deviceName: await getLocalDeviceLabel() }),
    }),
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
  refreshToken: (refreshToken: string) =>
    request<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  me: () => request<{ user: AuthResponse["user"] }>("/me"),
  updateMe: (input: UpdateUserPreferencesInput) =>
    request<{ user: AuthResponse["user"] }>("/me", {
      method: "PATCH",
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
  budgets: (month: string) => request<Budget[]>(`/budgets?month=${month}`),
  upsertBudget: (input: BudgetUpsertInput) =>
    request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  monthlyReport: (month: string) =>
    request<MonthlyReport>(`/reports/monthly?month=${month}`),
  aiPrediction: (input: AiPredictionRequest) =>
    request<AiPredictionResponse>("/reports/prediction", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
