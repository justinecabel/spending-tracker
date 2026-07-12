import { nanoid } from "nanoid/non-secure";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Transaction } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

type DraftInput = Omit<Transaction, "id" | "createdAt" | "updatedAt" | "deletedAt"> & {
  clientId: string;
};
type DraftState = {
  drafts: Transaction[];
  addDraft: (transaction: DraftInput) => Transaction;
  removeDraftByClientId: (clientId: string) => void;
};

export const draftTransactionsStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: [],
      addDraft: (transaction) => {
        const now = new Date().toISOString();
        const draft: Transaction = {
          ...transaction,
          id: transaction.clientId || `draft-${nanoid()}`,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        set((state) => ({
          drafts: [draft, ...state.drafts.filter((current) => current.id !== draft.id)],
        }));
        return draft;
      },
      removeDraftByClientId: (clientId) =>
        set((state) => ({
          drafts: state.drafts.filter((draft) => draft.id !== clientId),
        })),
    }),
    {
      name: "spending-tracker-drafts",
      storage: createJSONStorage(() => storage),
    },
  ),
);
