import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Budget, Category, Transaction } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

// These values must keep the same reference between Zustand snapshots. Returning
// a new [] from a selector makes useSyncExternalStore think the store changed
// continuously when a profile has not populated its cache yet.
export const EMPTY_CATEGORIES: Category[] = [];
export const EMPTY_TRANSACTIONS: Transaction[] = [];

type OfflineCacheState = {
  categoriesByUser: Record<string, Category[]>;
  transactionsByScope: Record<string, Transaction[]>;
  budgetsByScope: Record<string, Budget[]>;
  setCategories: (userId: string, categories: Category[]) => void;
  setTransactions: (scope: string, transactions: Transaction[]) => void;
  upsertCategory: (userId: string, category: Category) => void;
  removeCategory: (userId: string, id: string) => void;
  replaceCategory: (userId: string, temporaryId: string, category: Category) => void;
  setBudgets: (scope: string, budgets: Budget[]) => void;
  upsertBudget: (scope: string, budget: Budget) => void;
  updateTransaction: (userId: string, id: string, changes: Partial<Transaction>) => void;
  removeTransaction: (userId: string, id: string) => void;
};

export const offlineCacheStore = create<OfflineCacheState>()(
  persist(
    (set) => ({
      categoriesByUser: {},
      transactionsByScope: {},
      budgetsByScope: {},
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
        })),
      setBudgets: (scope, budgets) =>
        set((state) => ({
          budgetsByScope: { ...state.budgetsByScope, [scope]: budgets },
        })),
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
      updateTransaction: (userId, id, changes) =>
        set((state) => ({
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
    },
  ),
);

export function transactionScopeKey(userId: string, scope: string) {
  return `${userId}:${scope}`;
}
