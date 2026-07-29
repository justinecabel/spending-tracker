import { useEffect } from "react";
import type { AuthResponse } from "@spending-tracker/shared";
import { api } from "../lib/api";
import { sessionStore } from "../state/session";

export function useBootstrapSession() {
  const refreshToken = sessionStore((state) => state.refreshToken);
  const accessToken = sessionStore((state) => state.accessToken);
  const activeProfile = sessionStore((state) => state.activeProfile);
  const activeLinkedProfileUserId = sessionStore((state) => state.activeLinkedProfileUserId);
  const linkedProfiles = sessionStore((state) => state.linkedProfiles);
  const setSession = sessionStore((state) => state.setSession);
  const staleLinkedProfileUserId = sessionStore((state) => state.staleLinkedProfileUserId);

  useEffect(() => {
    if (accessToken || !refreshToken) {
      return;
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      api
        .restorePersistedSession()
        .catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (message.includes("network") || message.includes("fetch") || message.includes("abort")) {
            retryTimer = setTimeout(restore, 4_000);
            return;
          }
          // Authentication failures are handled by restorePersistedSession,
          // including recovery with the saved Device-ID or pairing credential.
        });
    };

    restore();
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [accessToken, refreshToken]);

  // Profiles saved by older versions only had a rotating session token. While
  // that session is still valid, securely save its stable sync credential so a
  // later PWA restart can recover without asking the user to type it again.
  const activeLinkedProfile = linkedProfiles.find((profile) => profile.user.id === activeLinkedProfileUserId);
  useEffect(() => {
    if (!accessToken || activeProfile !== "linked" || !activeLinkedProfile || activeLinkedProfile.pairingCode) {
      return;
    }

    let cancelled = false;
    void api
      .createTransferToken()
      .then(({ pairingCode }) => {
        if (cancelled) {
          return;
        }
        const current = sessionStore.getState();
        const profile = current.linkedProfiles.find((item) => item.user.id === activeLinkedProfile.user.id);
        if (!profile) {
          return;
        }
        const payload: AuthResponse = {
          accessToken: profile.accessToken,
          refreshToken: profile.refreshToken,
          user: profile.user,
        };
        setSession(payload, "linked", pairingCode);
      })
      .catch(() => {
        // If the current session cannot make an authenticated request, normal
        // refresh recovery handles it. Do not mark a still-valid saved profile
        // stale merely because this optional migration could not run.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, activeLinkedProfile, activeProfile, setSession]);

  return { staleLinkedProfileUserId };
}
