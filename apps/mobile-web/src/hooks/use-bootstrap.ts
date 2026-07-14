import { useEffect } from "react";
import type { ProfileSlot } from "@spending-tracker/shared";
import { api } from "../lib/api";
import { sessionStore } from "../state/session";

export function useBootstrapSession() {
  const refreshToken = sessionStore((state) => state.refreshToken);
  const accessToken = sessionStore((state) => state.accessToken);
  const activeProfile = sessionStore((state) => state.activeProfile);
  const setSession = sessionStore((state) => state.setSession);
  const clearSession = sessionStore((state) => state.clearSession);

  useEffect(() => {
    if (accessToken || !refreshToken) {
      return;
    }

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      api
        .refreshToken(refreshToken)
        .then((session) => {
          if (active) {
            setSession(session, (activeProfile ?? "device") as ProfileSlot);
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (message.includes("network") || message.includes("fetch") || message.includes("abort")) {
            retryTimer = setTimeout(restore, 4_000);
            return;
          }
          clearSession();
        });
    };

    restore();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [accessToken, activeProfile, clearSession, refreshToken, setSession]);
}
