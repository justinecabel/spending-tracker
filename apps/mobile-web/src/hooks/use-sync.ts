import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { draftTransactionsStore } from "../state/draft-transactions";
import { offlineCacheStore } from "../state/offline-cache";
import { offlineQueueStore } from "../state/offline-queue";

export function useSyncQueue(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    async function flush() {
      if ((typeof navigator !== "undefined" && !navigator.onLine) || cancelled) {
        return;
      }

      const { mutations, remove } = offlineQueueStore.getState();
      let processed = false;
      for (const mutation of mutations.filter((queuedMutation) => queuedMutation.userId === userId)) {
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
          if (mutation.entity === "category" && mutation.action === "create") {
            const payload = mutation.payload as {
              userId: string;
              temporaryId: string;
              data: Parameters<typeof api.createCategory>[0];
            };
            const category = await api.createCategory(payload.data);
            offlineCacheStore.getState().replaceCategory(payload.userId, payload.temporaryId, category);
            draftTransactionsStore.getState().replaceCategoryId(payload.temporaryId, category.id);
            offlineQueueStore.getState().replaceCategoryId(payload.temporaryId, category.id);
          }
          if (mutation.entity === "category" && mutation.action === "update") {
            const payload = mutation.payload as { id: string; data: Parameters<typeof api.updateCategory>[1] };
            await api.updateCategory(payload.id, payload.data);
          }
          if (mutation.entity === "category" && mutation.action === "delete") {
            const payload = mutation.payload as { id: string };
            await api.deleteCategory(payload.id);
          }
          if (mutation.entity === "preferences" && mutation.action === "update") {
            const payload = mutation.payload as Parameters<typeof api.updateMe>[0];
            await api.updateMe(payload);
          }
          if (mutation.entity === "budget" && mutation.action === "upsert") {
            const payload = mutation.payload as Parameters<typeof api.upsertBudget>[0];
            await api.upsertBudget(payload);
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
          queryClient.invalidateQueries({ queryKey: ["categories"] }),
          queryClient.invalidateQueries({ queryKey: ["budgets"] }),
        ]);
      }
    }

    void flush();
    const interval = setInterval(() => void flush(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [queryClient, userId]);
}
