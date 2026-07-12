import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { realtimeUrl } from "../lib/api";
import { sessionStore } from "../state/session";

type LiveUpdatePayload = {
  type: "connected" | "invalidate";
  keys?: string[];
  at: string;
};

const LIVE_QUERY_KEYS = ["categories", "transactions", "budgets", "report", "reports", "me"];

export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();
  const accessToken = sessionStore((state) => state.accessToken);

  useEffect(() => {
    if (!enabled || !accessToken || typeof WebSocket === "undefined") {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let closedByEffect = false;

    const connect = () => {
      const url = new URL("/ws", realtimeUrl);
      url.searchParams.set("token", accessToken);
      socket = new WebSocket(url.toString());

      socket.onmessage = (event) => {
        let payload: LiveUpdatePayload | null = null;

        try {
          payload = JSON.parse(String(event.data)) as LiveUpdatePayload;
        } catch {
          return;
        }

        if (payload.type !== "invalidate") {
          return;
        }

        const keys = payload.keys?.length ? payload.keys : LIVE_QUERY_KEYS;
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      };

      socket.onopen = () => {
        reconnectAttempts = 0;
      };

      socket.onclose = () => {
        socket = null;
        if (closedByEffect) {
          return;
        }

        const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [accessToken, enabled, queryClient]);
}
