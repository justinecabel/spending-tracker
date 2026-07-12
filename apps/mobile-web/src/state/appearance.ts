import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/storage";
import type { AppearanceMode } from "../theme";

type AppearanceState = {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
};

export const appearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      mode: "device",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "spending-tracker-appearance",
      storage: createJSONStorage(() => storage),
    },
  ),
);
