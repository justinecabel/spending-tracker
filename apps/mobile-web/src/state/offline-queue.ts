import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SyncMutation } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

type OfflineQueueState = {
  mutations: SyncMutation[];
  enqueue: (mutation: SyncMutation) => void;
  remove: (id: string) => void;
  removeByClientId: (clientId: string) => void;
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
      clear: () => set({ mutations: [] }),
    }),
    {
      name: "spending-tracker-sync-queue",
      storage: createJSONStorage(() => storage),
    },
  ),
);
