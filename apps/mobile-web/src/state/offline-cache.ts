import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Category, Transaction } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

// These values must keep the same reference between Zustand snapshots. Returning
// a new [] from a selector makes useSyncExternalStore think the store changed
// continuously when a profile has not populated its cache yet.
export const EMPTY_CATEGORIES: Category[] = [];
export const EMPTY_TRANSACTIONS: Transaction[] = [];

type OfflineCacheState = {
  categoriesByUser: Record<string, Category[]>;
  transactionsByScope: Record<string, Transaction[]>;
  setCategories: (userId: string, categories: Category[]) => void;
  setTransactions: (scope: string, transactions: Transaction[]) => void;
};

export const offlineCacheStore = create<OfflineCacheState>()(
  persist(
    (set) => ({
      categoriesByUser: {},
      transactionsByScope: {},
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
