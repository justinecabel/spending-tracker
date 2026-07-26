import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/storage";

export type SavedCountdown = {
  title: string;
  targetAt: string;
  createdAt?: string;
};

type CountdownState = {
  countdownsByUser: Record<string, SavedCountdown | undefined>;
  serverBackedByUser: Record<string, boolean | undefined>;
  saveCountdown: (userId: string, countdown: SavedCountdown) => void;
  removeCountdown: (userId: string) => void;
  markServerBacked: (userId: string) => void;
};

export const countdownStore = create<CountdownState>()(
  persist(
    (set) => ({
      countdownsByUser: {},
      serverBackedByUser: {},
      saveCountdown: (userId, countdown) =>
        set((state) => ({
          countdownsByUser: { ...state.countdownsByUser, [userId]: countdown },
        })),
      removeCountdown: (userId) =>
        set((state) => {
          const countdownsByUser = { ...state.countdownsByUser };
          delete countdownsByUser[userId];
          return { countdownsByUser };
        }),
      markServerBacked: (userId) =>
        set((state) => ({
          serverBackedByUser: { ...state.serverBackedByUser, [userId]: true },
        })),
    }),
    {
      name: "spending-tracker-countdowns",
      storage: createJSONStorage(() => storage),
    },
  ),
);
