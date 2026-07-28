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
import { ensureDeviceCredential, getLocalDeviceLabel } from "./device";
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
const TRANSACTION_PAGE_SIZE = 200;
const TRANSACTION_MAX_ROWS = 10_000;

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

    const deviceCredential = await ensureDeviceCredential();
    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken, ...deviceCredential }),
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

async function fetchTransactions(query: Record<string, string> = {}) {
  const transactions: Transaction[] = [];

  for (let offset = 0; offset < TRANSACTION_MAX_ROWS; offset += TRANSACTION_PAGE_SIZE) {
    const search = new URLSearchParams({
      ...query,
      limit: String(TRANSACTION_PAGE_SIZE),
      offset: String(offset),
    }).toString();
    const page = await request<Transaction[]>(`/transactions?${search}`);
    transactions.push(...page);
    if (page.length < TRANSACTION_PAGE_SIZE) {
      return transactions;
    }
  }

  const overflowSearch = new URLSearchParams({
    ...query,
    limit: "1",
    offset: String(TRANSACTION_MAX_ROWS),
  }).toString();
  const overflow = await request<Transaction[]>(`/transactions?${overflowSearch}`);
  if (overflow.length === 0) {
    return transactions;
  }
  throw new Error("Too many transactions to load at once; choose a narrower date range");
}

export const api = {
  signInWithDevice: async () => {
    const deviceCredential = await ensureDeviceCredential();
    return request<AuthResponse>("/auth/device", {
      method: "POST",
      body: JSON.stringify({ ...deviceCredential, deviceName: await getLocalDeviceLabel() }),
    });
  },
  signInWithGoogle: async (idToken: string) => {
    const deviceCredential = await ensureDeviceCredential();
    return request<AuthResponse>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken, ...deviceCredential }),
    });
  },
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
      body: JSON.stringify(input),
    }),
  refreshToken: async (refreshToken: string) => {
    const deviceCredential = await ensureDeviceCredential();
    return request<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken, ...deviceCredential }),
    });
  },
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
  importDeviceData: async (input: Omit<ImportDeviceDataInput, "deviceId">) => {
    const deviceCredential = await ensureDeviceCredential();
    return request<ImportDeviceDataResult>("/auth/import-device-data", {
      method: "POST",
      body: JSON.stringify({ ...input, ...deviceCredential }),
    });
  },
  ownDeviceData: async () => {
    const deviceCredential = await ensureDeviceCredential();
    return request<OwnDeviceDataResult>("/auth/own-device-data", {
      method: "POST",
      body: JSON.stringify(deviceCredential),
    });
  },
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
  transactions: (query?: Record<string, string>) => fetchTransactions(query),
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
