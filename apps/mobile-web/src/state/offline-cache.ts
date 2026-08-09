import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Budget, Category, Debt, Transaction } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

// These values must keep the same reference between Zustand snapshots. Returning
// a new [] from a selector makes useSyncExternalStore think the store changed
// continuously when a profile has not populated its cache yet.
export const EMPTY_CATEGORIES: Category[] = [];
export const EMPTY_TRANSACTIONS: Transaction[] = [];

type OfflineCacheState = {
  categoriesByUser: Record<string, Category[]>;
  transactionsByUser: Record<string, Transaction[]>;
  transactionsByScope: Record<string, Transaction[]>;
  budgetsByScope: Record<string, Budget[]>;
  debtsByUser: Record<string, Debt[]>;
  setCategories: (userId: string, categories: Category[]) => void;
  setTransactions: (scope: string, transactions: Transaction[]) => void;
  setTransactionsForUser: (
    userId: string,
    transactions: Transaction[],
    query?: Record<string, string>,
  ) => void;
  getTransactions: (userId: string, query?: Record<string, string>) => Transaction[];
  upsertTransaction: (userId: string, transaction: Transaction) => void;
  replaceTransaction: (userId: string, temporaryId: string, transaction: Transaction) => void;
  upsertCategory: (userId: string, category: Category) => void;
  removeCategory: (userId: string, id: string) => void;
  replaceCategory: (userId: string, temporaryId: string, category: Category) => void;
  setBudgets: (scope: string, budgets: Budget[]) => void;
  upsertBudget: (scope: string, budget: Budget) => void;
  setDebts: (userId: string, debts: Debt[]) => void;
  upsertDebt: (userId: string, debt: Debt) => void;
  replaceDebt: (userId: string, temporaryId: string, debt: Debt) => void;
  removeDebt: (userId: string, id: string) => void;
  updateTransaction: (userId: string, id: string, changes: Partial<Transaction>) => void;
  removeTransaction: (userId: string, id: string) => void;
};

export const offlineCacheStore = create<OfflineCacheState>()(
  persist(
    (set, get) => ({
      categoriesByUser: {},
      transactionsByUser: {},
      transactionsByScope: {},
      budgetsByScope: {},
      debtsByUser: {},
      setCategories: (userId, categories) =>
        set((state) => ({
          categoriesByUser: {
            ...state.categoriesByUser,
            [userId]: categories,
          },
        })),
      setTransactions: (scope, transactions) =>
        set((state) => ({
          transactionsByScope: {
            ...state.transactionsByScope,
            [scope]: transactions,
          },
        })),
      upsertCategory: (userId, category) =>
        set((state) => ({
          categoriesByUser: {
            ...state.categoriesByUser,
            [userId]: [
              category,
              ...(state.categoriesByUser[userId] ?? []).filter((current) => current.id !== category.id),
            ],
          },
        })),
      removeCategory: (userId, id) =>
        set((state) => ({
          categoriesByUser: {
            ...state.categoriesByUser,
            [userId]: (state.categoriesByUser[userId] ?? []).filter((category) => category.id !== id),
          },
        })),
      replaceCategory: (userId, temporaryId, category) =>
        set((state) => ({
          categoriesByUser: {
            ...state.categoriesByUser,
            [userId]: (state.categoriesByUser[userId] ?? []).map((current) =>
              current.id === temporaryId ? category : current,
            ),
          },
          transactionsByUser: {
            ...state.transactionsByUser,
            [userId]: (state.transactionsByUser[userId] ?? []).map((transaction) =>
              transaction.categoryId === temporaryId
                ? { ...transaction, categoryId: category.id }
                : transaction,
            ),
          },
          transactionsByScope: Object.fromEntries(
            Object.entries(state.transactionsByScope).map(([scope, transactions]) => [
              scope,
              scope.startsWith(`${userId}:`)
                ? transactions.map((transaction) =>
                    transaction.categoryId === temporaryId ? { ...transaction, categoryId: category.id } : transaction,
                  )
                : transactions,
            ]),
          ),
          budgetsByScope: Object.fromEntries(
            Object.entries(state.budgetsByScope).map(([scope, budgets]) => [
              scope,
              scope.startsWith(`${userId}:`)
                ? budgets.map((budget) =>
                    budget.categoryId === temporaryId ? { ...budget, categoryId: category.id } : budget,
                  )
                : budgets,
            ]),
          ),
          debtsByUser: {
            ...state.debtsByUser,
            [userId]: (state.debtsByUser[userId] ?? []).map((debt) =>
              debt.categoryId === temporaryId ? { ...debt, categoryId: category.id } : debt,
            ),
          },
        })),
      setBudgets: (scope, budgets) =>
        set((state) => ({
          budgetsByScope: { ...state.budgetsByScope, [scope]: budgets },
        })),
      setTransactionsForUser: (userId, transactions, query) =>
        set((state) => {
          const current = state.transactionsByUser[userId] ?? [];
          const isFullCollection = !query || Object.keys(query).length === 0;
          return {
            transactionsByUser: {
              ...state.transactionsByUser,
              [userId]: sortTransactions(
                // Map de-duplication keeps the last value for an ID. Put the
                // remote result last so an online refresh replaces an older
                // cached revision instead of persisting the stale copy.
                dedupeTransactions(isFullCollection ? transactions : [...current, ...transactions]),
              ),
            },
          };
        }),
      getTransactions: (userId, query) =>
        sortTransactions(
          (get().transactionsByUser[userId] ?? []).filter((transaction) =>
            matchesTransactionQuery(transaction, query),
          ),
        ),
      upsertTransaction: (userId, transaction) =>
        set((state) => ({
          transactionsByUser: {
            ...state.transactionsByUser,
            [userId]: sortTransactions(
              [transaction, ...(state.transactionsByUser[userId] ?? []).filter((current) => current.id !== transaction.id)],
            ),
          },
          transactionsByScope: Object.fromEntries(
            Object.entries(state.transactionsByScope).map(([scope, transactions]) => [
              scope,
              scope.startsWith(`${userId}:`)
                ? sortTransactions([transaction, ...transactions.filter((current) => current.id !== transaction.id)])
                : transactions,
            ]),
          ),
        })),
      replaceTransaction: (userId, temporaryId, transaction) =>
        set((state) => {
          const replace = (transactions: Transaction[]) =>
            sortTransactions([
              transaction,
              ...transactions.filter(
                (current) => current.id !== temporaryId && current.id !== transaction.id,
              ),
            ]);

          return {
            transactionsByUser: {
              ...state.transactionsByUser,
              [userId]: replace(state.transactionsByUser[userId] ?? []),
            },
            transactionsByScope: Object.fromEntries(
              Object.entries(state.transactionsByScope).map(([scope, transactions]) => [
                scope,
                scope.startsWith(`${userId}:`) ? replace(transactions) : transactions,
              ]),
            ),
          };
        }),
      upsertBudget: (scope, budget) =>
        set((state) => ({
          budgetsByScope: {
            ...state.budgetsByScope,
            [scope]: [
              budget,
              ...(state.budgetsByScope[scope] ?? []).filter(
                (current) => current.categoryId !== budget.categoryId,
              ),
            ],
          },
        })),
      setDebts: (userId, debts) =>
        set((state) => ({
          debtsByUser: {
            ...state.debtsByUser,
            [userId]: sortDebts(debts),
          },
        })),
      upsertDebt: (userId, debt) =>
        set((state) => ({
          debtsByUser: {
            ...state.debtsByUser,
            [userId]: sortDebts([
              debt,
              ...(state.debtsByUser[userId] ?? []).filter((current) => current.id !== debt.id),
            ]),
          },
        })),
      replaceDebt: (userId, temporaryId, debt) =>
        set((state) => ({
          debtsByUser: {
            ...state.debtsByUser,
            [userId]: sortDebts([
              debt,
              ...(state.debtsByUser[userId] ?? []).filter(
                (current) => current.id !== temporaryId && current.id !== debt.id,
              ),
            ]),
          },
        })),
      removeDebt: (userId, id) =>
        set((state) => ({
          debtsByUser: {
            ...state.debtsByUser,
            [userId]: (state.debtsByUser[userId] ?? []).filter((debt) => debt.id !== id),
          },
        })),
      updateTransaction: (userId, id, changes) =>
        set((state) => ({
          transactionsByUser: {
            ...state.transactionsByUser,
            [userId]: (state.transactionsByUser[userId] ?? []).map((transaction) =>
              transaction.id === id
                ? { ...transaction, ...changes, updatedAt: new Date().toISOString() }
                : transaction,
            ),
          },
          transactionsByScope: Object.fromEntries(
            Object.entries(state.transactionsByScope).map(([scope, transactions]) => [
              scope,
              scope.startsWith(`${userId}:`)
                ? transactions.map((transaction) =>
                    transaction.id === id
                      ? { ...transaction, ...changes, updatedAt: new Date().toISOString() }
                      : transaction,
                  )
                : transactions,
            ]),
          ),
        })),
      removeTransaction: (userId, id) =>
        set((state) => ({
          transactionsByUser: {
            ...state.transactionsByUser,
            [userId]: (state.transactionsByUser[userId] ?? []).filter((transaction) => transaction.id !== id),
          },
          transactionsByScope: Object.fromEntries(
            Object.entries(state.transactionsByScope).map(([scope, transactions]) => [
              scope,
              scope.startsWith(`${userId}:`)
                ? transactions.filter((transaction) => transaction.id !== id)
                : transactions,
            ]),
          ),
        })),
    }),
    {
      name: "spending-tracker-offline-cache",
      storage: createJSONStorage(() => storage),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<OfflineCacheState>;
        if (state.transactionsByUser) {
          return state as OfflineCacheState;
        }

        const transactionsByUser: Record<string, Transaction[]> = {};
        for (const [scope, transactions] of Object.entries(state.transactionsByScope ?? {})) {
          const separator = scope.indexOf(":");
          const userId = separator === -1 ? "" : scope.slice(0, separator);
          if (!userId) continue;
          transactionsByUser[userId] = sortTransactions(
            dedupeTransactions([...(transactionsByUser[userId] ?? []), ...transactions]),
          );
        }

        return {
          ...state,
          transactionsByUser,
          debtsByUser: state.debtsByUser ?? {},
        } as OfflineCacheState;
      },
    },
  ),
);

export function transactionScopeKey(userId: string, scope: string) {
  return `${userId}:${scope}`;
}

function matchesTransactionQuery(transaction: Transaction, query?: Record<string, string>) {
  if (transaction.deletedAt) return false;
  if (query?.from && transaction.occurredAt < query.from) return false;
  if (query?.to && transaction.occurredAt > query.to) return false;
  if (query?.categoryId && transaction.categoryId !== query.categoryId) return false;
  if (query?.kind && transaction.kind !== query.kind) return false;
  if (query?.search) {
    const search = query.search.toLocaleLowerCase();
    if (
      !transaction.merchant?.toLocaleLowerCase().includes(search) &&
      !transaction.note?.toLocaleLowerCase().includes(search)
    ) {
      return false;
    }
  }
  return true;
}

function dedupeTransactions(transactions: Transaction[]) {
  return [...new Map(transactions.map((transaction) => [transaction.id, transaction])).values()];
}

function sortTransactions(transactions: Transaction[]) {
  return [...transactions].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function sortDebts(debts: Debt[]) {
  return [...debts].sort(
    (left, right) =>
      Number(Boolean(left.paidAt)) - Number(Boolean(right.paidAt)) ||
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}
