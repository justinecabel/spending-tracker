import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildForecastAnalysis, type Category, type CreateCategoryInput, type Transaction } from "@spending-tracker/shared";
import { Card, Metric, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import { formatDateLabel, formatMoney } from "../../src/lib/date";
import { buildSpendingReport, budgetMonthsForRange, resolveSummaryRange } from "../../src/lib/summary-range";
import { TransactionForm } from "../../src/components/transaction-form";
import { draftTransactionsStore } from "../../src/state/draft-transactions";
import { offlineCacheStore, transactionScopeKey } from "../../src/state/offline-cache";
import { offlineQueueStore } from "../../src/state/offline-queue";
import { summaryRangeStore } from "../../src/state/summary-range";
import { sessionStore } from "../../src/state/session";
import { appShellStore } from "../../src/state/app-shell";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { nanoid } from "nanoid/non-secure";
import { Modal, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { theme } from "../../src/theme";
import { WebPressable as Pressable } from "../../src/components/web-pressable";

export default function DashboardScreen() {
  const user = sessionStore((state) => state.user);
  const { width } = useWindowDimensions();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const summaryMode = summaryRangeStore((state) => state.mode);
  const customFrom = summaryRangeStore((state) => state.customFrom);
  const customTo = summaryRangeStore((state) => state.customTo);
  const smartPaydays = summaryRangeStore((state) => state.smartPaydays);
  const range = resolveSummaryRange({
    mode: summaryMode,
    customFrom,
    customTo,
    smartPaydays,
  });
  const queryClient = useQueryClient();
  const addDraft = draftTransactionsStore((state) => state.addDraft);
  const drafts = draftTransactionsStore((state) => state.drafts);
  const enqueue = offlineQueueStore((state) => state.enqueue);
  const userId = user?.id ?? "anonymous";
  const cachedCategories = offlineCacheStore((state) => state.categoriesByUser[userId]);
  const transactionCacheId = transactionScopeKey(userId, `summary:${range.key}`);
  const cachedTransactions = offlineCacheStore((state) => state.transactionsByScope[transactionCacheId]);
  const historyCacheId = transactionScopeKey(userId, "forecast-history");
  const cachedHistory = offlineCacheStore((state) => state.transactionsByScope[historyCacheId]);
  const budgetMonths = budgetMonthsForRange(range);

  const categoriesQuery = useQuery({
    queryKey: ["categories", userId],
    queryFn: async () => {
      try {
        const categories = await api.categories();
        offlineCacheStore.getState().setCategories(userId, categories);
        return categories;
      } catch (error) {
        if (cachedCategories) {
          return cachedCategories;
        }
        throw error;
      }
    },
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", userId, "summary", range.key],
    queryFn: async () => {
      try {
        const transactions = await api.transactions({
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        });
        offlineCacheStore.getState().setTransactions(transactionCacheId, transactions);
        return transactions;
      } catch (error) {
        if (cachedTransactions) {
          return cachedTransactions;
        }
        throw error;
      }
    },
  });

  const historyQuery = useQuery({
    queryKey: ["transactions", userId, "forecast-history"],
    queryFn: async () => {
      try {
        const transactions = await api.transactions();
        offlineCacheStore.getState().setTransactions(historyCacheId, transactions);
        return transactions;
      } catch (error) {
        if (cachedHistory) {
          return cachedHistory;
        }
        throw error;
      }
    },
  });

  const budgetsQuery = useQuery({
    queryKey: ["budgets", userId, "forecast", budgetMonths.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        budgetMonths.map(async (month) => {
          const cacheId = transactionScopeKey(userId, `budgets:${month}`);
          const cached = offlineCacheStore.getState().budgetsByScope[cacheId];
          try {
            const budgets = await api.budgets(month);
            offlineCacheStore.getState().setBudgets(cacheId, budgets);
            return budgets;
          } catch {
            return cached ?? [];
          }
        }),
      );
      return results.flat();
    },
  });

  const createTransaction = useMutation({
    mutationFn: api.createTransaction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const createCategory = useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateCategory>[1] }) =>
      api.updateCategory(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  function isOfflineOrNetworkError(error?: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("network") || message.includes("fetch");
  }

  function refreshCategoryData() {
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  }

  function queueCategoryCreate(data: CreateCategoryInput): Category {
    const now = new Date().toISOString();
    const temporaryId = `category-${nanoid()}`;
    const category: Category = {
      id: temporaryId,
      userId,
      name: data.name,
      kind: data.kind,
      color: data.color,
      icon: data.icon,
      isSystem: false,
      sortOrder: (offlineCacheStore.getState().categoriesByUser[userId] ?? []).length,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    offlineCacheStore.getState().upsertCategory(userId, category);
    enqueue({
      id: nanoid(),
      userId,
      entity: "category",
      action: "create",
      payload: { userId, temporaryId, data },
      createdAt: now,
    });
    refreshCategoryData();
    return category;
  }

  function queueCategoryUpdate(id: string, data: Parameters<typeof api.updateCategory>[1]): Category {
    const current = (offlineCacheStore.getState().categoriesByUser[userId] ?? []).find((category) => category.id === id);
    const category: Category = {
      ...(current ?? {
        id,
        userId,
        name: data.name ?? "Category",
        kind: data.kind ?? "expense",
        color: data.color ?? theme.colors.accent,
        icon: data.icon ?? "wallet",
        isSystem: false,
        sortOrder: 0,
        archived: false,
        createdAt: new Date().toISOString(),
      }),
      ...data,
      updatedAt: new Date().toISOString(),
    };
    offlineCacheStore.getState().upsertCategory(userId, category);
    enqueue({
      id: nanoid(),
      userId,
      entity: "category",
      action: "update",
      payload: { id, data },
      createdAt: new Date().toISOString(),
    });
    refreshCategoryData();
    return category;
  }

  async function handleCreateCategory(data: CreateCategoryInput) {
    if (isOfflineOrNetworkError()) {
      return queueCategoryCreate(data);
    }
    try {
      return await createCategory.mutateAsync(data);
    } catch (error) {
      if (isOfflineOrNetworkError(error)) {
        return queueCategoryCreate(data);
      }
      throw error;
    }
  }

  async function handleUpdateCategory(id: string, data: Parameters<typeof api.updateCategory>[1]) {
    if (isOfflineOrNetworkError()) {
      return queueCategoryUpdate(id, data);
    }
    try {
      return await updateCategory.mutateAsync({ id, data });
    } catch (error) {
      if (isOfflineOrNetworkError(error)) {
        return queueCategoryUpdate(id, data);
      }
      throw error;
    }
  }

  async function handleDeleteCategory(id: string) {
    if (isOfflineOrNetworkError()) {
      const archivedCategory = queueCategoryUpdate(id, { archived: true });
      const queuedUpdate = offlineQueueStore.getState().mutations.at(-1);
      if (queuedUpdate?.entity === "category" && queuedUpdate.action === "update") {
        offlineQueueStore.getState().remove(queuedUpdate.id);
      }
      enqueue({
        id: nanoid(),
        userId,
        entity: "category",
        action: "delete",
        payload: { id },
        createdAt: new Date().toISOString(),
      });
      return archivedCategory;
    }
    try {
      const deleted = await deleteCategory.mutateAsync(id);
      offlineCacheStore.getState().upsertCategory(userId, deleted);
      return deleted;
    } catch (error) {
      if (isOfflineOrNetworkError(error)) {
        const archivedCategory = queueCategoryUpdate(id, { archived: true });
        const queuedUpdate = offlineQueueStore.getState().mutations.at(-1);
        if (queuedUpdate?.entity === "category" && queuedUpdate.action === "update") {
          offlineQueueStore.getState().remove(queuedUpdate.id);
        }
        enqueue({
          id: nanoid(),
          userId,
          entity: "category",
          action: "delete",
          payload: { id },
          createdAt: new Date().toISOString(),
        });
        return archivedCategory;
      }
      throw error;
    }
  }

  async function handleCreateTransaction(input: Parameters<typeof api.createTransaction>[0]) {
    const clientId = input.clientId ?? `client-${Date.now()}`;
    const payload = {
      ...input,
      clientId,
    };
    if (isOfflineOrNetworkError()) {
      addDraft({
        userId: user?.id ?? "offline-user",
        categoryId: payload.categoryId,
        amount: payload.amount,
        kind: payload.kind,
        occurredAt: payload.occurredAt,
        note: payload.note ?? null,
        merchant: payload.merchant ?? null,
        clientId,
      });
      enqueue({
        id: nanoid(),
        userId,
        entity: "transaction",
        action: "create",
        payload,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    try {
      await createTransaction.mutateAsync(payload);
    } catch (error) {
      if (isOfflineOrNetworkError(error)) {
        addDraft({
          userId: user?.id ?? "offline-user",
          categoryId: payload.categoryId,
          amount: payload.amount,
          kind: payload.kind,
          occurredAt: payload.occurredAt,
          note: payload.note ?? null,
          merchant: payload.merchant ?? null,
          clientId,
        });
        enqueue({
          id: nanoid(),
          userId,
          entity: "transaction",
          action: "create",
          payload,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      throw error;
    }
  }

  const offlineDrafts = drafts.filter((transaction) => {
    if (transaction.userId !== userId) {
      return false;
    }

    if (range.from && transaction.occurredAt < range.from) {
      return false;
    }
    if (range.to && transaction.occurredAt > range.to) {
      return false;
    }
    return true;
  });
  const transactions = [...offlineDrafts, ...(transactionsQuery.data ?? [])].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  );
  const historyTransactions = [
    ...drafts.filter((transaction) => transaction.userId === userId),
    ...(historyQuery.data ?? cachedHistory ?? []),
  ];
  // A newly signed-in profile has no query result or offline cache yet. Keep
  // the first render safe while the server creates/returns its categories.
  const categories = categoriesQuery.data ?? cachedCategories ?? [];
  const budgets = budgetsQuery.data ?? [];
  const report = buildSpendingReport(range.title, transactions, categories);
  const forecast = buildForecastAnalysis({ transactions, historyTransactions, categories, budgets, range });
  const projectedPeriodEnd = forecast.projectedTotal;
  const stacked = width < 820;
  const compact = width < 640;

  const monthCard = (
    <Card>
      <SectionTitle title={range.title} subtitle={range.subtitle} />
      <View style={styles.metrics}>
        <Metric label="Spent" value={formatMoney(report?.expenseTotal ?? 0, user?.currency ?? "USD")} tone="warning" />
      </View>
    </Card>
  );

  const predictionCard = (
    <Card>
      <SectionTitle title="Forecast" />
      <View style={styles.predictionMetaRow}>
        <Text style={styles.predictionMeta} numberOfLines={1}>
          Projected total · {forecast.confidenceLabel.toLowerCase()} confidence
        </Text>
      </View>
      <View style={styles.predictionRow}>
        <Text style={styles.predictionValue}>{formatMoney(projectedPeriodEnd, user?.currency ?? "USD")}</Text>
        <PillButton label="View report" tone="ghost" onPress={() => appShellStore.getState().setTab("reports")} />
      </View>
    </Card>
  );

  const recentCard = (
    <Card>
      <SectionTitle title="Recent transactions" />
      <View style={[styles.list, styles.recentList]}>
        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No transactions yet. Use Add transaction to start building your history.</Text>
          </View>
        ) : (
          transactions.slice(0, 5).map((transaction, index, items) => {
          const isDraft = transaction.id.startsWith("client-");
          return (
          <Pressable
            key={transaction.id}
            style={[styles.row, isDraft && styles.pendingRow, index === items.length - 1 && styles.rowLast]}
            onPress={() => appShellStore.getState().showTransaction(transaction.id)}
          >
            <View>
              <Text style={styles.rowTitle}>{transaction.merchant ?? transaction.note ?? "Transaction"}</Text>
              <Text style={styles.rowMeta}>
                {formatDateLabel(transaction.occurredAt)}
                {isDraft ? " · Pending sync" : ""}
              </Text>
            </View>
            <Text style={styles.rowAmount}>{formatMoney(transaction.amount, user?.currency ?? "USD")}</Text>
          </Pressable>
          );
          })
        )}
      </View>
    </Card>
  );

  const topCategoriesCard = (
    <Card>
      <SectionTitle title="Top categories" />
      <View style={[styles.list, styles.categoryList]}>
        {report.byCategory.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No categories to rank yet. Your top categories will appear after you add expenses.</Text>
          </View>
        ) : (
          report.byCategory.map((item, index, items) => (
          <View
            key={item.categoryId ?? item.categoryName}
            style={[styles.row, index === items.length - 1 && styles.rowLast]}
          >
            <View style={styles.categoryName}>
              <Text style={styles.rowTitle}>{item.categoryName}</Text>
            </View>
            <Text style={styles.rowAmount}>{formatMoney(item.total, user?.currency ?? "USD")}</Text>
          </View>
          ))
        )}
      </View>
    </Card>
  );

  const merchantSuggestions = Array.from(
    new Set(
      transactions
        .map((transaction) => transaction.merchant?.trim() ?? "")
        .filter((merchant) => merchant.length > 0),
    ),
  );

  return (
    <View style={styles.screen}>
      <ScreenContainer
        screenKey="home"
        fabSafeInset
        refreshing={isRefreshing}
        onRefresh={async () => {
          setIsRefreshing(true);
          try {
            await Promise.all([categoriesQuery.refetch(), transactionsQuery.refetch(), historyQuery.refetch(), budgetsQuery.refetch()]);
          } finally {
            setIsRefreshing(false);
          }
        }}
      >
        <PageHeader title="Summary" />
        {stacked ? (
          <View style={[styles.column, styles.columnStackedSafe, compact && styles.columnCompactSafe]}>
            {monthCard}
            {predictionCard}
            {recentCard}
            {topCategoriesCard}
          </View>
        ) : (
          <View style={styles.desktopGrid}>
            <View style={styles.desktopColumn}>
              {monthCard}
              {predictionCard}
              {recentCard}
            </View>
            <View style={styles.desktopColumn}>
              {topCategoriesCard}
            </View>
          </View>
        )}
      </ScreenContainer>

      <Pressable style={[styles.fab, compact && styles.fabCompact]} onPress={() => setIsQuickAddOpen(true)}>
        <Text style={styles.fabPlus}>+</Text>
        <Text style={[styles.fabLabel, compact && styles.fabLabelCompact]}>Add transaction</Text>
      </Pressable>

      <Modal transparent visible={isQuickAddOpen} animationType="fade" onRequestClose={() => setIsQuickAddOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, compact && styles.modalCardCompact]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Quick add</Text>
              <PillButton label="Close" tone="ghost" onPress={() => setIsQuickAddOpen(false)} />
            </View>
            {categoriesQuery.isPending ? (
              <Text style={styles.modalInfo}>Loading categories...</Text>
            ) : categoriesQuery.error ? (
              <View style={styles.quickAddFallback}>
                <Text style={styles.errorText}>{categoriesQuery.error.message}</Text>
                <PillButton
                  label="Retry"
                  tone="ghost"
                  onPress={() => {
                    void categoriesQuery.refetch();
                  }}
                />
              </View>
            ) : (
              <TransactionForm
                categories={categoriesQuery.data ?? []}
                merchantSuggestions={merchantSuggestions}
                onSubmit={async (input) => {
                  await handleCreateTransaction(input);
                  setIsQuickAddOpen(false);
                }}
                onCreateCategory={({ name, color }) =>
                  handleCreateCategory({
                    name,
                    color,
                    icon: "wallet",
                    kind: "expense",
                  })
                }
                onUpdateCategory={(id, data) =>
                  handleUpdateCategory(id, data)
                }
                onDeleteCategory={handleDeleteCategory}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  column: {
    gap: 20,
  },
  columnStackedSafe: {
    marginBottom: 80,
  },
  columnCompactSafe: {
    marginBottom: 60,
  },
  desktopGrid: {
    flexDirection: "row",
    gap: 20,
    width: "100%",
  },
  desktopColumn: {
    flex: 1,
    minWidth: 0,
    gap: 20,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
  },
  predictionRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
  },
  predictionMetaRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  predictionMeta: {
    color: theme.colors.muted,
    flexShrink: 1,
    fontSize: 15,
  },
  predictionValue: {
    color: theme.colors.accent,
    fontSize: 34,
    fontWeight: "800",
  },
  list: {
    gap: 14,
  },
  categoryList: {
    marginTop: 20,
  },
  recentList: {
    marginTop: 20,
  },
  quickAddFallback: {
    gap: 12,
    alignItems: "flex-start",
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(27, 29, 31, 0.35)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    gap: 16,
    width: "100%",
    maxWidth: 460,
    maxHeight: "88%",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  modalCardCompact: {
    padding: 16,
    gap: 14,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: theme.colors.ink,
  },
  modalInfo: {
    color: theme.colors.muted,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  pendingRow: {
    backgroundColor: "rgba(194, 65, 12, 0.10)",
    borderLeftColor: theme.colors.warning,
    borderLeftWidth: 3,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  rowMeta: {
    fontSize: 13,
    color: theme.colors.muted,
  },
  categoryName: {
    flex: 1,
    justifyContent: "center",
  },
  rowAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  errorText: {
    color: theme.colors.warning,
  },
  emptyState: {
    paddingVertical: 4,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 15,
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    ...theme.shadow,
  },
  fabCompact: {
    left: 12,
    right: 12,
    bottom: 12,
    justifyContent: "center",
    paddingVertical: 12,
  },
  fabPlus: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 22,
  },
  fabLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  fabLabelCompact: {
    fontSize: 14,
  },
});
