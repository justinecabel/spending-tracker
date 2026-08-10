import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deviceBackend } from "../backend/device-backend";

const REFRESHED_QUERY_KEYS = [
  "categories",
  "transactions",
  "budgets",
  "debts",
  "countdown",
  "report",
  "reports",
  "me",
];

/**
 * Refreshes the complete on-device snapshot whenever a usable remote connection
 * becomes available. Screen queries are often date-scoped, so relying on only
 * the currently visible screen can leave other offline ranges behind.
 */
export function useOfflineCacheRefresh(enabled: boolean) {
  const queryClient = useQueryClient();
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (!enabled || (typeof navigator !== "undefined" && !navigator.onLine)) {
      return Promise.resolve();
    }
    if (inFlight.current) {
      return inFlight.current;
    }

    const request = Promise.allSettled([
      deviceBackend.categories(),
      deviceBackend.transactions(),
      deviceBackend.debts(),
    ])
      .then(async (results) => {
        if (!results.some((result) => result.status === "fulfilled")) {
          return;
        }
        await Promise.all(
          REFRESHED_QUERY_KEYS.map((key) =>
            queryClient.invalidateQueries({ queryKey: [key], refetchType: "active" }),
          ),
        );
      })
      .finally(() => {
        if (inFlight.current === request) {
          inFlight.current = null;
        }
      });

    inFlight.current = request;
    return request;
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refresh();
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleOnline = () => void refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, refresh]);
}
