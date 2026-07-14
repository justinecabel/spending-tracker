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
