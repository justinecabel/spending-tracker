import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SyncMutation } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

type OfflineQueueState = {
  mutations: SyncMutation[];
  enqueue: (mutation: SyncMutation) => void;
  remove: (id: string) => void;
  removeByClientId: (clientId: string) => void;
  replaceCategoryId: (fromCategoryId: string, toCategoryId: string) => void;
  replaceDebtId: (fromDebtId: string, toDebtId: string) => void;
  replaceTransactionId: (fromTransactionId: string, toTransactionId: string) => void;
  updateTransactionCreate: (clientId: string, data: Record<string, unknown>) => void;
  clear: () => void;
};

export const offlineQueueStore = create<OfflineQueueState>()(
  persist(
    (set) => ({
      mutations: [],
      enqueue: (mutation) =>
        set((state) => ({
          mutations: [...state.mutations, mutation],
        })),
      remove: (id) =>
        set((state) => ({
          mutations: state.mutations.filter((mutation) => mutation.id !== id),
        })),
      removeByClientId: (clientId) =>
        set((state) => ({
          mutations: state.mutations.filter((mutation) => {
            const payload = mutation.payload as { clientId?: string } | undefined;
            return payload?.clientId !== clientId;
          }),
        })),
      replaceCategoryId: (fromCategoryId, toCategoryId) =>
        set((state) => ({
          mutations: state.mutations.map((mutation) => {
            const payload = mutation.payload as {
              id?: string;
              categoryId?: string;
              data?: { categoryId?: string };
            };
            const nextPayload = {
              ...payload,
              ...(mutation.entity === "category" && payload.id === fromCategoryId ? { id: toCategoryId } : {}),
              ...(payload.categoryId === fromCategoryId ? { categoryId: toCategoryId } : {}),
              ...(payload.data?.categoryId === fromCategoryId
                ? { data: { ...payload.data, categoryId: toCategoryId } }
                : {}),
            };
            return { ...mutation, payload: nextPayload };
          }),
        })),
      replaceDebtId: (fromDebtId, toDebtId) =>
        set((state) => ({
          mutations: state.mutations.map((mutation) => {
            if (mutation.entity !== "debt") {
              return mutation;
            }
            const payload = mutation.payload as { id?: string; temporaryId?: string };
            return {
              ...mutation,
              payload: {
                ...payload,
                ...(payload.id === fromDebtId ? { id: toDebtId } : {}),
                ...(payload.temporaryId === fromDebtId ? { temporaryId: toDebtId } : {}),
              },
            };
          }),
        })),
      replaceTransactionId: (fromTransactionId, toTransactionId) =>
        set((state) => ({
          mutations: state.mutations.map((mutation) => {
            if (mutation.entity !== "transaction" || mutation.action === "create") {
              return mutation;
            }
            const payload = mutation.payload as { id?: string };
            return {
              ...mutation,
              payload: {
                ...payload,
                ...(payload.id === fromTransactionId ? { id: toTransactionId } : {}),
              },
            };
          }),
        })),
      updateTransactionCreate: (clientId, data) =>
        set((state) => ({
          mutations: state.mutations.map((mutation) => {
            if (mutation.entity !== "transaction" || mutation.action !== "create") {
              return mutation;
            }
            const payload = mutation.payload as { clientId?: string };
            return payload.clientId === clientId
              ? { ...mutation, payload: { ...payload, ...data } }
              : mutation;
          }),
        })),
      clear: () => set({ mutations: [] }),
    }),
    {
      name: "spending-tracker-sync-queue",
      storage: createJSONStorage(() => storage),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<OfflineQueueState>;
        return {
          ...state,
          // Queue entries created before v2 were not tied to a profile. They
          // cannot be safely replayed after the user switches accounts.
          mutations: (state.mutations ?? []).filter((mutation) => typeof mutation?.userId === "string" && mutation.userId.length > 0),
        } as OfflineQueueState;
      },
    },
  ),
);
