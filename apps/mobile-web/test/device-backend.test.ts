import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Category,
  Debt,
  Transaction,
} from "@spending-tracker/shared";
import { createDeviceBackend } from "../src/backend/device-backend";
import type { RemoteStorage } from "../src/backend/remote-storage";
import { countdownStore } from "../src/state/countdown";
import { offlineCacheStore } from "../src/state/offline-cache";
import { offlineQueueStore } from "../src/state/offline-queue";

const userId = "device-user";
const now = "2026-07-28T10:00:00.000Z";

function remoteStorage(overrides: Partial<RemoteStorage> = {}): RemoteStorage {
  return {
    categories: vi.fn(async () => []),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    transactions: vi.fn(async () => []),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    debts: vi.fn(async () => []),
    createDebt: vi.fn(),
    updateDebt: vi.fn(),
    deleteDebt: vi.fn(),
    countdown: vi.fn(async () => null),
    upsertCountdown: vi.fn(),
    deleteCountdown: vi.fn(),
    budgets: vi.fn(async () => []),
    upsertBudget: vi.fn(),
    updateMe: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  offlineCacheStore.setState({
    categoriesByUser: {},
    transactionsByUser: {},
    transactionsByScope: {},
    budgetsByScope: {},
    debtsByUser: {},
  });
  offlineQueueStore.setState({ mutations: [] });
  countdownStore.setState({ countdownsByUser: {}, serverBackedByUser: {} });
});

describe("device backend", () => {
  it("persists pulled collections and serves them when remote storage is unavailable", async () => {
    const categories: Category[] = [
      {
        id: "food",
        userId,
        name: "Food",
        kind: "expense",
        color: "#123456",
        icon: "wallet",
        isSystem: false,
        sortOrder: 0,
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const transaction: Transaction = {
      id: "transaction-1",
      userId,
      categoryId: "food",
      amount: 20,
      kind: "expense",
      occurredAt: "2026-07-20T12:00:00.000Z",
      note: "Lunch",
      merchant: "Cafe",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const online = createDeviceBackend(
      remoteStorage({
        categories: vi.fn(async () => categories),
        transactions: vi.fn(async () => [transaction]),
      }),
      () => userId,
    );

    await expect(online.categories()).resolves.toEqual(categories);
    await expect(online.transactions()).resolves.toEqual([transaction]);

    const offline = createDeviceBackend(
      remoteStorage({
        categories: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
        transactions: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
      }),
      () => userId,
    );

    await expect(offline.categories()).resolves.toEqual(categories);
    await expect(
      offline.transactions({
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T23:59:59.999Z",
        search: "cafe",
      }),
    ).resolves.toEqual([transaction]);
    await expect(
      offline.transactions({ from: "2026-08-01T00:00:00.000Z" }),
    ).resolves.toEqual([]);
  });

  it("stores an unavailable debt create locally and queues an idempotent remote mutation", async () => {
    const otherCategory: Category = {
      id: "other",
      userId,
      name: "Other",
      kind: "expense",
      color: "#123456",
      icon: "wallet",
      isSystem: true,
      sortOrder: 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    offlineCacheStore.getState().setCategories(userId, [otherCategory]);
    const backend = createDeviceBackend(
      remoteStorage({
        createDebt: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
      }),
      () => userId,
    );

    const debt = await backend.createDebt({
      merchant: "Landlord",
      amount: 500,
      dueAt: "2026-08-01T09:00:00.000Z",
      reminderDaysBefore: 1,
    });

    expect(debt.id).toMatch(/^debt-/);
    expect(debt.categoryId).toBe("other");
    expect(offlineCacheStore.getState().debtsByUser[userId]).toEqual([debt]);

    const queued = offlineQueueStore.getState().mutations;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      userId,
      entity: "debt",
      action: "create",
      payload: {
        temporaryId: debt.id,
        data: {
          merchant: "Landlord",
          clientId: expect.stringMatching(/^debt-client-/),
        },
      },
    });
  });

  it("creates, edits, and deletes transactions locally while the remote is unavailable", async () => {
    const backend = createDeviceBackend(
      remoteStorage({
        createTransaction: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
        updateTransaction: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
        deleteTransaction: vi.fn(async () => {
          throw new Error("Failed to fetch");
        }),
      }),
      () => userId,
    );

    const created = await backend.createTransaction({
      clientId: "client-new-transaction",
      categoryId: "food",
      amount: 20,
      kind: "expense",
      occurredAt: "2026-07-28T12:00:00.000Z",
      merchant: "Cafe",
    });

    expect(created.id).toBe("client-new-transaction");
    expect(offlineCacheStore.getState().getTransactions(userId)).toEqual([created]);
    expect(offlineQueueStore.getState().mutations).toMatchObject([
      {
        userId,
        entity: "transaction",
        action: "create",
        payload: { clientId: "client-new-transaction", amount: 20 },
      },
    ]);

    const updated = await backend.updateTransaction(created.id, { amount: 25, note: "With tip" });
    expect(updated).toMatchObject({ id: created.id, amount: 25, note: "With tip" });
    expect(offlineCacheStore.getState().getTransactions(userId)).toMatchObject([
      { id: created.id, amount: 25, note: "With tip" },
    ]);
    expect(offlineQueueStore.getState().mutations).toHaveLength(1);
    expect(offlineQueueStore.getState().mutations[0]).toMatchObject({
      action: "create",
      payload: { clientId: created.id, amount: 25, note: "With tip" },
    });

    await backend.deleteTransaction(created.id);
    expect(offlineCacheStore.getState().getTransactions(userId)).toEqual([]);
    expect(offlineQueueStore.getState().mutations).toEqual([]);
  });

  it("creates transactions immediately when the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      const createTransaction = vi.fn(async () => {
        throw new Error("The remote should not be called while offline");
      });
      const backend = createDeviceBackend(
        remoteStorage({ createTransaction }),
        () => userId,
      );

      const transaction = await backend.createTransaction({
        clientId: "offline-transaction",
        categoryId: "food",
        amount: 18,
        kind: "expense",
        occurredAt: "2026-07-28T12:00:00.000Z",
        merchant: "Cafe",
      });

      expect(transaction.id).toBe("offline-transaction");
      expect(createTransaction).not.toHaveBeenCalled();
      expect(offlineQueueStore.getState().mutations).toMatchObject([
        {
          userId,
          entity: "transaction",
          action: "create",
          payload: { clientId: "offline-transaction" },
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues edits and deletes for transactions already saved remotely", async () => {
    const transaction: Transaction = {
      id: "transaction-1",
      userId,
      categoryId: "food",
      amount: 20,
      kind: "expense",
      occurredAt: "2026-07-28T12:00:00.000Z",
      note: null,
      merchant: "Cafe",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    offlineCacheStore.getState().upsertTransaction(userId, transaction);
    const backend = createDeviceBackend(
      remoteStorage({
        updateTransaction: vi.fn(async () => {
          throw new Error("Network unavailable");
        }),
        deleteTransaction: vi.fn(async () => {
          throw new Error("Network unavailable");
        }),
      }),
      () => userId,
    );

    await backend.updateTransaction(transaction.id, { amount: 24 });
    expect(offlineCacheStore.getState().getTransactions(userId)).toMatchObject([
      { id: transaction.id, amount: 24 },
    ]);

    await backend.deleteTransaction(transaction.id);
    expect(offlineCacheStore.getState().getTransactions(userId)).toEqual([]);
    expect(offlineQueueStore.getState().mutations).toMatchObject([
      { entity: "transaction", action: "update", payload: { id: transaction.id, data: { amount: 24 } } },
      { entity: "transaction", action: "delete", payload: { id: transaction.id } },
    ]);
  });

  it("keeps countdown changes on device until remote storage returns", async () => {
    const backend = createDeviceBackend(
      remoteStorage({
        upsertCountdown: vi.fn(async () => {
          throw new Error("Network unavailable");
        }),
      }),
      () => userId,
    );

    const countdown = await backend.upsertCountdown({
      title: "Trip",
      targetAt: "2026-08-15T00:00:00.000Z",
    });

    expect(countdownStore.getState().countdownsByUser[userId]).toMatchObject({
      title: "Trip",
      targetAt: "2026-08-15T00:00:00.000Z",
    });
    expect(offlineQueueStore.getState().mutations).toHaveLength(1);
    expect(offlineQueueStore.getState().mutations[0]).toMatchObject({
      userId,
      entity: "countdown",
      action: "upsert",
    });
  });
});
