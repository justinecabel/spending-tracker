import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/storage";
import type { AppearanceMode } from "../theme";

export function getAppearanceProfileKey(activeProfile: "device" | "linked" | null, userId?: string | null) {
  if (activeProfile && userId) {
    return `${activeProfile}:${userId}`;
  }

  return "default";
}

type AppearanceState = {
  mode: AppearanceMode;
  profileModes: Record<string, AppearanceMode>;
  profileAccents: Record<string, string | null>;
  profileSecondaryAccents: Record<string, string | null>;
  setMode: (profileKey: string, mode: AppearanceMode) => void;
  getMode: (profileKey: string) => AppearanceMode;
  setAccent: (profileKey: string, accent: string | null) => void;
  getAccent: (profileKey: string) => string | null;
  setSecondaryAccent: (profileKey: string, accent: string | null) => void;
  getSecondaryAccent: (profileKey: string) => string | null;
};

export const appearanceStore = create<AppearanceState>()(
  persist(
    (set, get) => ({
      mode: "device",
      profileModes: {},
      profileAccents: {},
      profileSecondaryAccents: {},
      setMode: (profileKey, mode) =>
        set((state) => ({
          mode,
          profileModes: {
            ...(state.profileModes ?? {}),
            [profileKey]: mode,
          },
        })),
      getMode: (profileKey) => (get().profileModes ?? {})[profileKey] ?? get().mode,
      setAccent: (profileKey, accent) =>
        set((state) => ({
          profileAccents: {
            ...(state.profileAccents ?? {}),
            [profileKey]: accent,
          },
        })),
      getAccent: (profileKey) => (get().profileAccents ?? {})[profileKey] ?? null,
      setSecondaryAccent: (profileKey, accent) =>
        set((state) => ({
          profileSecondaryAccents: {
            ...(state.profileSecondaryAccents ?? {}),
            [profileKey]: accent,
          },
        })),
      getSecondaryAccent: (profileKey) => (get().profileSecondaryAccents ?? {})[profileKey] ?? null,
    }),
    {
      name: "spending-tracker-appearance",
      storage: createJSONStorage(() => storage),
    },
  ),
);
