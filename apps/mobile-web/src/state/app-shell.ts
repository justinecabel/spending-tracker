import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/storage";

export type TabKey = "home" | "transactions" | "budgets" | "reports" | "settings";

const validTabs: TabKey[] = ["home", "transactions", "reports", "settings"];

export function normalizeTabKey(value: unknown): TabKey {
  if (typeof value === "string" && validTabs.includes(value as TabKey)) {
    return value as TabKey;
  }

  return "home";
}

type AppShellState = {
  tab: TabKey;
  transactionToView: string | null;
  scrollOffsets: Partial<Record<TabKey | "sign-in", number>>;
  setTab: (tab: TabKey) => void;
  showTransaction: (id: string) => void;
  clearTransactionToView: () => void;
  setScrollOffset: (key: TabKey | "sign-in", value: number) => void;
};

export const appShellStore = create<AppShellState>()(
  persist(
    (set) => ({
      tab: "home",
      transactionToView: null,
      scrollOffsets: {},
      setTab: (tab) => set({ tab: normalizeTabKey(tab) }),
      showTransaction: (id) => set({ tab: "transactions", transactionToView: id }),
      clearTransactionToView: () => set({ transactionToView: null }),
      setScrollOffset: (key, value) =>
        set((state) => ({
          scrollOffsets: {
            ...state.scrollOffsets,
            [key]: value,
          },
        })),
    }),
    {
      name: "spending-tracker-app-shell",
      storage: createJSONStorage(() => storage),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AppShellState>;

        return {
          ...currentState,
          ...persisted,
          tab: normalizeTabKey(persisted.tab),
          transactionToView: null,
          scrollOffsets: persisted.scrollOffsets ?? currentState.scrollOffsets,
        };
      },
    },
  ),
);
