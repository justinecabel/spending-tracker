import type {
  Budget,
  Category,
  Countdown,
  Debt,
  SyncMutation,
  Transaction,
} from "@spending-tracker/shared";
import { nanoid } from "nanoid/non-secure";
import { countdownStore } from "../state/countdown";
import { draftTransactionsStore } from "../state/draft-transactions";
import { offlineCacheStore, transactionScopeKey } from "../state/offline-cache";
import { offlineQueueStore } from "../state/offline-queue";
import { sessionStore } from "../state/session";
import { remoteStorage, type RemoteStorage } from "./remote-storage";

function activeUserId() {
  const userId = sessionStore.getState().user?.id;
  if (!userId) {
    throw new Error("No active on-device profile");
  }
  return userId;
}

function sortTransactions(transactions: Transaction[]) {
  return [...transactions].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function overlayPendingTransactions(
  userId: string,
  remoteTransactions: Transaction[],
  query?: Record<string, string>,
) {
  const pendingMutations = offlineQueueStore.getState().mutations.filter(
    (mutation) => mutation.userId === userId && mutation.entity === "transaction",
  );
  const pendingDeleteIds = new Set(
    pendingMutations.flatMap((mutation) => {
      if (mutation.action !== "delete") {
        return [];
      }

      const payload = mutation.payload as { id?: string };
      return payload.id ? [payload.id] : [];
    }),
  );
  const pendingUpsertIds = new Set(
    pendingMutations.flatMap((mutation) => {
      if (mutation.action === "delete") {
        return [];
      }

      const payload = mutation.payload as { clientId?: string; id?: string };
      const id = mutation.action === "create" ? payload.clientId : payload.id;
      return id ? [id] : [];
    }),
  );
  if (pendingUpsertIds.size === 0 && pendingDeleteIds.size === 0) {
    return remoteTransactions;
  }

  const pendingLocal = offlineCacheStore
    .getState()
    .getTransactions(userId, query)
    .filter((transaction) => pendingUpsertIds.has(transaction.id));
  return sortTransactions([
    ...remoteTransactions.filter(
      (transaction) => !pendingUpsertIds.has(transaction.id) && !pendingDeleteIds.has(transaction.id),
    ),
    ...pendingLocal,
  ]);
}

function sortDebts(debts: Debt[]) {
  return [...debts].sort(
    (left, right) =>
      Number(Boolean(left.paidAt)) - Number(Boolean(right.paidAt)) ||
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function localFallback<T>(value: T | undefined, error: unknown): T {
  if (value !== undefined) {
    return value;
  }
  throw error;
}

function isRemoteUnavailable(error: unknown) {
  if (isBrowserOffline()) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("unavailable")
  );
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function enqueue(
  userId: string,
  mutation: Omit<SyncMutation, "id" | "userId" | "createdAt">,
) {
  offlineQueueStore.getState().enqueue({
    ...mutation,
    id: nanoid(),
    userId,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Local-first data backend used by the application.
 *
 * Reads pull the newest remote copy when possible, persist it on device, and
 * fall back to the on-device copy. Writes update the on-device copy after the
 * remote adapter accepts them; unavailable writes are captured here or by the
 * interaction layer and replayed by useSyncQueue.
 */
export function createDeviceBackend(
  remote: RemoteStorage = remoteStorage,
  getUserId: () => string = activeUserId,
) {
  return {
    async categories(): Promise<Category[]> {
      const userId = getUserId();
      const cached = offlineCacheStore.getState().categoriesByUser[userId];
      try {
        const categories = await remote.categories();
        offlineCacheStore.getState().setCategories(userId, categories);
        return categories;
      } catch (error) {
        return localFallback(cached, error);
      }
    },

    async createCategory(input: Parameters<RemoteStorage["createCategory"]>[0]) {
      const userId = getUserId();
      const category = await remote.createCategory(input);
      offlineCacheStore.getState().upsertCategory(userId, category);
      return category;
    },

    async updateCategory(
      id: string,
      input: Parameters<RemoteStorage["updateCategory"]>[1],
    ) {
      const userId = getUserId();
      const category = await remote.updateCategory(id, input);
      offlineCacheStore.getState().upsertCategory(userId, category);
      return category;
    },

    async deleteCategory(id: string) {
      const userId = getUserId();
      const category = await remote.deleteCategory(id);
      offlineCacheStore.getState().upsertCategory(userId, category);
      return category;
    },

    async transactions(query?: Record<string, string>): Promise<Transaction[]> {
      const userId = getUserId();
      const cached = offlineCacheStore.getState().transactionsByUser[userId];

      // A refetch is triggered after local mutations so the active query can
      // refresh its result. Do not send that refetch back to a known-offline
      // network: the newly saved transaction is already in the device cache.
      if (isBrowserOffline() && cached !== undefined) {
        return offlineCacheStore.getState().getTransactions(userId, query);
      }

      try {
        const transactions = overlayPendingTransactions(userId, await remote.transactions(query), query);
        offlineCacheStore.getState().setTransactionsForUser(userId, transactions, query);
        return transactions;
      } catch (error) {
        const local = cached === undefined
          ? undefined
          : offlineCacheStore.getState().getTransactions(userId, query);
        return localFallback(local, error);
      }
    },

    async createTransaction(input: Parameters<RemoteStorage["createTransaction"]>[0]) {
      const userId = getUserId();
      const clientId = input.clientId ?? `client-${nanoid()}`;
      const remoteInput = { ...input, clientId };

      const saveLocally = () => {
        const now = new Date().toISOString();
        const transaction: Transaction = {
          id: clientId,
          userId,
          categoryId: input.categoryId,
          amount: input.amount,
          kind: input.kind ?? "expense",
          occurredAt: input.occurredAt,
          note: input.note ?? null,
          merchant: input.merchant ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        offlineCacheStore.getState().upsertTransaction(userId, transaction);
        enqueue(userId, {
          entity: "transaction",
          action: "create",
          payload: remoteInput,
        });
        return transaction;
      };

      if (isBrowserOffline()) {
        return saveLocally();
      }

      try {
        const transaction = await remote.createTransaction(remoteInput);
        offlineCacheStore.getState().upsertTransaction(userId, transaction);
        return transaction;
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        return saveLocally();
      }
    },

    async updateTransaction(
      id: string,
      input: Parameters<RemoteStorage["updateTransaction"]>[1],
    ) {
      const userId = getUserId();
      const queue = offlineQueueStore.getState();
      const hasPendingCreate = queue.mutations.some((mutation) => {
        const payload = mutation.payload as { clientId?: string };
        return mutation.entity === "transaction" && mutation.action === "create" && payload.clientId === id;
      });
      if (hasPendingCreate) {
        const current =
          offlineCacheStore
            .getState()
            .transactionsByUser[userId]?.find((transaction) => transaction.id === id) ??
          draftTransactionsStore
            .getState()
            .drafts.find((transaction) => transaction.userId === userId && transaction.id === id);
        if (!current) {
          throw new Error("Transaction is not available on this device");
        }
        const transaction: Transaction = { ...current, ...input, updatedAt: new Date().toISOString() };
        queue.updateTransactionCreate(id, input);
        offlineCacheStore.getState().upsertTransaction(userId, transaction);
        return transaction;
      }
      try {
        const transaction = await remote.updateTransaction(id, input);
        offlineCacheStore.getState().upsertTransaction(userId, transaction);
        return transaction;
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        const current =
          offlineCacheStore
            .getState()
            .transactionsByUser[userId]?.find((transaction) => transaction.id === id) ??
          draftTransactionsStore
            .getState()
            .drafts.find((transaction) => transaction.userId === userId && transaction.id === id);
        if (!current) {
          throw error;
        }
        const updatedAt = new Date().toISOString();
        const transaction: Transaction = { ...current, ...input, updatedAt };
        if (hasPendingCreate) {
          queue.updateTransactionCreate(id, input);
        } else {
          enqueue(userId, {
            entity: "transaction",
            action: "update",
            payload: { id, data: input },
          });
        }
        offlineCacheStore.getState().upsertTransaction(userId, transaction);
        return transaction;
      }
    },

    async deleteTransaction(id: string) {
      const userId = getUserId();
      const cache = offlineCacheStore.getState();
      const hasPendingCreate = offlineQueueStore.getState().mutations.some((mutation) => {
        const payload = mutation.payload as { clientId?: string };
        return mutation.entity === "transaction" && mutation.action === "create" && payload.clientId === id;
      });
      if (hasPendingCreate) {
        cache.removeTransaction(userId, id);
        draftTransactionsStore.getState().removeDraftByClientId(id);
        offlineQueueStore.getState().removeByClientId(id);
        return;
      }
      try {
        await remote.deleteTransaction(id);
        cache.removeTransaction(userId, id);
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        cache.removeTransaction(userId, id);
        enqueue(userId, {
          entity: "transaction",
          action: "delete",
          payload: { id },
        });
      }
    },

    async debts(): Promise<Debt[]> {
      const userId = getUserId();
      const cached = offlineCacheStore.getState().debtsByUser[userId];
      try {
        const debts = await remote.debts();
        offlineCacheStore.getState().setDebts(userId, debts);
        return debts;
      } catch (error) {
        return localFallback(cached === undefined ? undefined : sortDebts(cached), error);
      }
    },

    async createDebt(input: Parameters<RemoteStorage["createDebt"]>[0]) {
      const userId = getUserId();
      const clientId = input.clientId ?? `debt-client-${nanoid()}`;
      const remoteInput = { ...input, clientId };
      try {
        const debt = await remote.createDebt(remoteInput);
        offlineCacheStore.getState().upsertDebt(userId, debt);
        return debt;
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }

        const cache = offlineCacheStore.getState();
        const fallbackCategoryId =
          input.categoryId ??
          cache.categoriesByUser[userId]?.find(
            (category) => !category.archived && category.name.trim().toLocaleLowerCase() === "other",
          )?.id ??
          cache.categoriesByUser[userId]?.find((category) => !category.archived)?.id ??
          "pending-category";
        const now = new Date().toISOString();
        const temporaryId = `debt-${nanoid()}`;
        const debt: Debt = {
          id: temporaryId,
          userId,
          categoryId: fallbackCategoryId,
          merchant: input.merchant,
          amount: input.amount,
          dueAt: input.dueAt,
          reminderDaysBefore: input.reminderDaysBefore ?? null,
          paidAt: null,
          createdAt: now,
          updatedAt: now,
        };
        cache.upsertDebt(userId, debt);
        enqueue(userId, {
          entity: "debt",
          action: "create",
          payload: { temporaryId, data: remoteInput },
        });
        return debt;
      }
    },

    async updateDebt(id: string, input: Parameters<RemoteStorage["updateDebt"]>[1]) {
      const userId = getUserId();
      try {
        const debt = await remote.updateDebt(id, input);
        offlineCacheStore.getState().upsertDebt(userId, debt);
        return debt;
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        const current = offlineCacheStore
          .getState()
          .debtsByUser[userId]?.find((debt) => debt.id === id);
        if (!current) {
          throw error;
        }
        const debt: Debt = {
          ...current,
          ...input,
          reminderDaysBefore:
            input.reminderDaysBefore === undefined
              ? current.reminderDaysBefore
              : input.reminderDaysBefore,
          paidAt: input.paidAt === undefined ? current.paidAt : input.paidAt,
          updatedAt: new Date().toISOString(),
        };
        offlineCacheStore.getState().upsertDebt(userId, debt);
        enqueue(userId, {
          entity: "debt",
          action: "update",
          payload: { id, data: input },
        });
        return debt;
      }
    },

    async deleteDebt(id: string) {
      const userId = getUserId();
      try {
        await remote.deleteDebt(id);
        offlineCacheStore.getState().removeDebt(userId, id);
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        offlineCacheStore.getState().removeDebt(userId, id);
        if (id.startsWith("debt-")) {
          const queue = offlineQueueStore.getState();
          for (const mutation of queue.mutations) {
            if (mutation.entity !== "debt") continue;
            const payload = mutation.payload as { id?: string; temporaryId?: string };
            if (payload.id === id || payload.temporaryId === id) {
              queue.remove(mutation.id);
            }
          }
          return;
        }
        enqueue(userId, {
          entity: "debt",
          action: "delete",
          payload: { id },
        });
      }
    },

    async countdown(): Promise<Countdown | null> {
      const userId = getUserId();
      const countdownState = countdownStore.getState();
      const hasLocalState = countdownState.serverBackedByUser[userId] !== undefined;
      const serverStateKnown = Boolean(countdownState.serverBackedByUser[userId]);
      const cached = countdownState.countdownsByUser[userId] ?? null;
      try {
        let countdown = await remote.countdown();
        if (!countdown && cached && !serverStateKnown) {
          countdown = await remote.upsertCountdown({
            title: cached.title,
            targetAt: cached.targetAt,
            ...(cached.createdAt ? { createdAt: cached.createdAt } : {}),
          });
        }
        if (countdown) {
          countdownState.saveCountdown(userId, countdown);
        } else {
          countdownState.removeCountdown(userId);
        }
        countdownState.markServerBacked(userId);
        return countdown;
      } catch (error) {
        const localCountdown: Countdown | null | undefined =
          hasLocalState || cached
            ? cached
              ? {
                  userId,
                  title: cached.title,
                  targetAt: cached.targetAt,
                  createdAt: cached.createdAt ?? new Date(0).toISOString(),
                  updatedAt: cached.createdAt ?? new Date(0).toISOString(),
                }
              : null
            : undefined;
        return localFallback(localCountdown, error);
      }
    },

    async upsertCountdown(input: Parameters<RemoteStorage["upsertCountdown"]>[0]) {
      const userId = getUserId();
      try {
        const countdown = await remote.upsertCountdown(input);
        countdownStore.getState().saveCountdown(userId, countdown);
        countdownStore.getState().markServerBacked(userId);
        return countdown;
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        const now = new Date().toISOString();
        const countdown: Countdown = {
          userId,
          title: input.title,
          targetAt: input.targetAt,
          createdAt: input.createdAt ?? now,
          updatedAt: now,
        };
        countdownStore.getState().saveCountdown(userId, countdown);
        enqueue(userId, {
          entity: "countdown",
          action: "upsert",
          payload: input,
        });
        return countdown;
      }
    },

    async deleteCountdown() {
      const userId = getUserId();
      try {
        await remote.deleteCountdown();
        countdownStore.getState().removeCountdown(userId);
        countdownStore.getState().markServerBacked(userId);
      } catch (error) {
        if (!isRemoteUnavailable(error)) {
          throw error;
        }
        countdownStore.getState().removeCountdown(userId);
        enqueue(userId, {
          entity: "countdown",
          action: "delete",
          payload: {},
        });
      }
    },

    async budgets(month: string): Promise<Budget[]> {
      const userId = getUserId();
      const scope = transactionScopeKey(userId, `budgets:${month}`);
      const cached = offlineCacheStore.getState().budgetsByScope[scope];
      try {
        const budgets = await remote.budgets(month);
        offlineCacheStore.getState().setBudgets(scope, budgets);
        return budgets;
      } catch (error) {
        return localFallback(cached, error);
      }
    },

    async upsertBudget(input: Parameters<RemoteStorage["upsertBudget"]>[0]) {
      const userId = getUserId();
      const budget = await remote.upsertBudget(input);
      const scope = transactionScopeKey(userId, `budgets:${budget.month}`);
      offlineCacheStore.getState().upsertBudget(scope, budget);
      return budget;
    },

    sortTransactions,
  };
}

export const deviceBackend = createDeviceBackend();
