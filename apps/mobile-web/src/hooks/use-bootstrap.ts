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

    api
      .refreshToken(refreshToken)
      .then((session) => setSession(session, (activeProfile ?? "device") as ProfileSlot))
      .catch(() => clearSession());
  }, [accessToken, activeProfile, clearSession, refreshToken, setSession]);
}
