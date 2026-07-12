import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/storage";

export type SummaryRangeMode =
  | "this-month"
  | "all-time"
  | "last-30-days"
  | "last-15-days"
  | "custom-date"
  | "smart-pay-cycle";

type SummaryRangeState = {
  mode: SummaryRangeMode;
  customFrom: string;
  customTo: string;
  smartPaydays: string;
  setMode: (mode: SummaryRangeMode) => void;
  setCustomRange: (customFrom: string, customTo: string) => void;
  setSmartPaydays: (value: string) => void;
};

export const summaryRangeStore = create<SummaryRangeState>()(
  persist(
    (set) => ({
      mode: "this-month",
      customFrom: "",
      customTo: "",
      smartPaydays: "15,30",
      setMode: (mode) => set({ mode }),
      setCustomRange: (customFrom, customTo) => set({ customFrom, customTo }),
      setSmartPaydays: (smartPaydays) => set({ smartPaydays }),
    }),
    {
      name: "spending-tracker-summary-range",
      storage: createJSONStorage(() => storage),
    },
  ),
);
