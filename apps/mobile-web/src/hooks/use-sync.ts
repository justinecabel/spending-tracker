import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { draftTransactionsStore } from "../state/draft-transactions";
import { offlineQueueStore } from "../state/offline-queue";

export function useSyncQueue(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function flush() {
      if ((typeof navigator !== "undefined" && !navigator.onLine) || cancelled) {
        return;
      }

      const { mutations, remove } = offlineQueueStore.getState();
      let processed = false;
      for (const mutation of mutations) {
        try {
          if (mutation.entity === "transaction" && mutation.action === "create") {
            const payload = mutation.payload as { clientId?: string };
            await api.createTransaction(payload as never);
            if (payload.clientId) {
              draftTransactionsStore.getState().removeDraftByClientId(payload.clientId);
            }
          }
          if (mutation.entity === "transaction" && mutation.action === "update") {
            const payload = mutation.payload as { id: string; data: Record<string, unknown> };
            await api.updateTransaction(payload.id, payload.data as never);
          }
          if (mutation.entity === "transaction" && mutation.action === "delete") {
            const payload = mutation.payload as { id: string };
            await api.deleteTransaction(payload.id);
          }
          remove(mutation.id);
          processed = true;
        } catch {
          break;
        }
      }

      if (processed && !cancelled) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["transactions"] }),
          queryClient.invalidateQueries({ queryKey: ["reports"] }),
          queryClient.invalidateQueries({ queryKey: ["report"] }),
        ]);
      }
    }

    void flush();
    const interval = setInterval(() => void flush(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);
}
