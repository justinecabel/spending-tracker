import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuthResponse, ProfileSlot, User } from "@spending-tracker/shared";
import { storage } from "../lib/storage";

type StoredProfileSession = Pick<AuthResponse, "accessToken" | "refreshToken" | "user">;
const MAX_LINKED_PROFILES = 5;

type SessionState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  activeProfile: ProfileSlot | null;
  activeLinkedProfileUserId: string | null;
  deviceProfile: StoredProfileSession | null;
  linkedProfiles: StoredProfileSession[];
  hydrated: boolean;
  setSession: (payload: AuthResponse, slot?: ProfileSlot) => void;
  setUser: (user: User) => void;
  updateDeviceProfileUser: (user: User) => void;
  activateProfile: (slot: ProfileSlot, linkedProfileUserId?: string) => void;
  removeLinkedProfile: (userId: string) => void;
  clearSession: () => void;
  setHydrated: (value: boolean) => void;
};

function withActiveState(
  state: Omit<SessionState, "setSession" | "setUser" | "updateDeviceProfileUser" | "activateProfile" | "removeLinkedProfile" | "clearSession" | "setHydrated">,
) {
  const activeSession =
    state.activeProfile === "device"
      ? state.deviceProfile
      : state.activeProfile === "linked"
        ? state.linkedProfiles.find((profile) => profile.user.id === state.activeLinkedProfileUserId) ?? null
        : null;

  return {
    ...state,
    accessToken: activeSession?.accessToken ?? null,
    refreshToken: activeSession?.refreshToken ?? null,
    user: activeSession?.user ?? null,
  };
}

function fallbackProfile(deviceProfile: StoredProfileSession | null, linkedProfiles: StoredProfileSession[]) {
  if (deviceProfile) {
    return "device" satisfies ProfileSlot;
  }
  if (linkedProfiles.length > 0) {
    return "linked" satisfies ProfileSlot;
  }
  return null;
}

function fallbackLinkedProfileUserId(linkedProfiles: StoredProfileSession[]) {
  return linkedProfiles[0]?.user.id ?? null;
}

function upsertLinkedProfile(
  linkedProfiles: StoredProfileSession[],
  nextProfile: StoredProfileSession,
) {
  const withoutDuplicate = linkedProfiles.filter((profile) => profile.user.id !== nextProfile.user.id);
  return [nextProfile, ...withoutDuplicate].slice(0, MAX_LINKED_PROFILES);
}

export const sessionStore = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      activeProfile: null,
      activeLinkedProfileUserId: null,
      deviceProfile: null,
      linkedProfiles: [],
      hydrated: true,
      setSession: (payload, slot = "device") =>
        set((state) => {
          const nextLinkedProfiles = slot === "linked" ? upsertLinkedProfile(state.linkedProfiles, payload) : state.linkedProfiles;
          return withActiveState({
            ...state,
            activeProfile: slot,
            activeLinkedProfileUserId:
              slot === "linked" ? payload.user.id : state.activeLinkedProfileUserId,
            deviceProfile: slot === "device" ? payload : state.deviceProfile,
            linkedProfiles: nextLinkedProfiles,
          });
        }),
      setUser: (user) =>
        set((state) => {
          if (!state.activeProfile) {
            return state;
          }

          const activeSession =
            state.activeProfile === "device"
              ? state.deviceProfile
              : state.linkedProfiles.find((profile) => profile.user.id === state.activeLinkedProfileUserId) ?? null;
          if (!activeSession) {
            return state;
          }

          return withActiveState({
            ...state,
            deviceProfile:
              state.activeProfile === "device"
                ? { ...activeSession, user }
                : state.deviceProfile,
            linkedProfiles:
              state.activeProfile === "linked"
                ? state.linkedProfiles.map((profile) =>
                    profile.user.id === state.activeLinkedProfileUserId ? { ...profile, user } : profile,
                  )
                : state.linkedProfiles,
          });
        }),
      updateDeviceProfileUser: (user) =>
        set((state) => {
          if (!state.deviceProfile) {
            return state;
          }

          return withActiveState({
            ...state,
            deviceProfile: {
              ...state.deviceProfile,
              user,
            },
          });
        }),
      activateProfile: (slot, linkedProfileUserId) =>
        set((state) => {
          const nextProfile =
            slot === "device"
              ? state.deviceProfile
              : state.linkedProfiles.find((profile) => profile.user.id === (linkedProfileUserId ?? state.activeLinkedProfileUserId)) ??
                state.linkedProfiles[0] ??
                null;
          if (!nextProfile) {
            return state;
          }

          return withActiveState({
            ...state,
            activeProfile: slot,
            activeLinkedProfileUserId:
              slot === "linked" ? nextProfile.user.id : state.activeLinkedProfileUserId,
          });
        }),
      removeLinkedProfile: (userId) =>
        set((state) => {
          const nextLinkedProfiles = state.linkedProfiles.filter((profile) => profile.user.id !== userId);
          const nextActiveProfile =
            state.activeProfile === "linked" && state.activeLinkedProfileUserId === userId
              ? fallbackProfile(state.deviceProfile, nextLinkedProfiles)
              : state.activeProfile;
          const nextActiveLinkedProfileUserId =
            state.activeLinkedProfileUserId === userId
              ? fallbackLinkedProfileUserId(nextLinkedProfiles)
              : state.activeLinkedProfileUserId;

          return withActiveState({
            ...state,
            activeProfile: nextActiveProfile,
            activeLinkedProfileUserId: nextActiveLinkedProfileUserId,
            linkedProfiles: nextLinkedProfiles,
          });
        }),
      clearSession: () =>
        set((state) => {
          if (!state.accessToken && !state.refreshToken && !state.user && state.activeProfile === null) {
            return state;
          }

          return withActiveState({
            ...state,
            activeProfile: null,
          });
        }),
      setHydrated: (value) => set({ hydrated: value }),
    }),
    {
      name: "spending-tracker-session",
      storage: createJSONStorage(() => storage),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        if (!("linkedProfiles" in state) || !Array.isArray(state.linkedProfiles)) {
          const legacyLinkedProfile = (state as SessionState & { linkedProfile?: StoredProfileSession | null }).linkedProfile;
          state.linkedProfiles = legacyLinkedProfile ? [legacyLinkedProfile] : [];
        }

        const nextActiveProfile =
          typeof state.activeProfile === "undefined"
            ? fallbackProfile(state.deviceProfile, state.linkedProfiles)
            : state.activeProfile;
        const nextActiveLinkedProfileUserId =
          state.activeLinkedProfileUserId ??
          fallbackLinkedProfileUserId(state.linkedProfiles);
        const activeSession =
          nextActiveProfile === "device"
            ? state.deviceProfile
            : nextActiveProfile === "linked"
              ? state.linkedProfiles.find((profile) => profile.user.id === nextActiveLinkedProfileUserId) ?? null
              : null;

        state.activeProfile = nextActiveProfile;
        state.activeLinkedProfileUserId = nextActiveLinkedProfileUserId;
        state.accessToken = activeSession?.accessToken ?? null;
        state.refreshToken = activeSession?.refreshToken ?? null;
        state.user = activeSession?.user ?? null;
        state.setHydrated(true);
      },
    },
  ),
);

export type { StoredProfileSession };
