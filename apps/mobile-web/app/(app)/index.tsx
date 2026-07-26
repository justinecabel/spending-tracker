import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildForecastAnalysis, type Category, type CreateCategoryInput, type Transaction } from "@spending-tracker/shared";
import { Card, FormModal, Metric, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import { combineDateAndTime, formatDateLabel, formatDateTimeLabel, formatMoney, toDateInputValue } from "../../src/lib/date";
import { calculateCountdownProgress } from "../../src/lib/countdown-progress";
import { buildSpendingReport, budgetMonthsForRange, resolveSummaryRange } from "../../src/lib/summary-range";
import { TransactionForm } from "../../src/components/transaction-form";
import { draftTransactionsStore } from "../../src/state/draft-transactions";
import { offlineCacheStore, transactionScopeKey } from "../../src/state/offline-cache";
import { offlineQueueStore } from "../../src/state/offline-queue";
import { summaryRangeStore } from "../../src/state/summary-range";
import { sessionStore } from "../../src/state/session";
import { appShellStore } from "../../src/state/app-shell";
import { countdownStore } from "../../src/state/countdown";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { nanoid } from "nanoid/non-secure";
import { Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { theme } from "../../src/theme";
import { WebPressable as Pressable } from "../../src/components/web-pressable";

export default function DashboardScreen() {
  const user = sessionStore((state) => state.user);
  const userId = user?.id ?? "anonymous";
  const { width } = useWindowDimensions();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCountdownOpen, setIsCountdownOpen] = useState(false);
  const [isCountdownMenuOpen, setIsCountdownMenuOpen] = useState(false);
  const [countdownTitle, setCountdownTitle] = useState("");
  const [countdownDate, setCountdownDate] = useState("");
  const [countdownError, setCountdownError] = useState("");
  const [countdownSyncError, setCountdownSyncError] = useState("");
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const cachedCountdown = countdownStore((state) => state.countdownsByUser[userId]);
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

  const debtsQuery = useQuery({
    queryKey: ["debts", userId],
    queryFn: api.debts,
  });

  const countdownQuery = useQuery({
    queryKey: ["countdown", userId],
    queryFn: async () => {
      const remoteCountdown = await api.countdown();
      const countdownState = countdownStore.getState();
      const localCountdown = countdownState.countdownsByUser[userId];
      const serverStateKnown = countdownState.serverBackedByUser[userId];

      if (!remoteCountdown && localCountdown && !serverStateKnown) {
        const migratedCountdown = await api.upsertCountdown({
          title: localCountdown.title,
          targetAt: localCountdown.targetAt,
          ...(localCountdown.createdAt ? { createdAt: localCountdown.createdAt } : {}),
        });
        countdownState.saveCountdown(userId, migratedCountdown);
        countdownState.markServerBacked(userId);
        return migratedCountdown;
      }

      if (remoteCountdown) {
        countdownState.saveCountdown(userId, remoteCountdown);
      } else {
        countdownState.removeCountdown(userId);
      }
      countdownState.markServerBacked(userId);
      return remoteCountdown;
    },
  });

  const saveCountdownMutation = useMutation({
    mutationFn: api.upsertCountdown,
    onMutate: () => {
      setCountdownError("");
      setCountdownSyncError("");
    },
    onSuccess: (countdown) => {
      countdownStore.getState().saveCountdown(userId, countdown);
      countdownStore.getState().markServerBacked(userId);
      queryClient.setQueryData(["countdown", userId], countdown);
      setCountdownNow(Date.now());
      closeCountdownForm();
    },
    onError: (error) => {
      setCountdownError(error instanceof Error ? error.message : "Could not sync the countdown.");
    },
  });

  const deleteCountdownMutation = useMutation({
    mutationFn: api.deleteCountdown,
    onMutate: () => {
      setIsCountdownMenuOpen(false);
      setCountdownSyncError("");
    },
    onSuccess: () => {
      countdownStore.getState().removeCountdown(userId);
      countdownStore.getState().markServerBacked(userId);
      queryClient.setQueryData(["countdown", userId], null);
    },
    onError: (error) => {
      setCountdownSyncError(error instanceof Error ? error.message : "Could not remove the countdown.");
    },
  });

  const savedCountdown = countdownQuery.data === undefined ? cachedCountdown : countdownQuery.data;

  useEffect(() => {
    const timer = setInterval(() => setCountdownNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  function openCountdownForm() {
    const defaultTarget = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    setIsCountdownMenuOpen(false);
    setCountdownTitle(savedCountdown?.title ?? "");
    setCountdownDate(toDateInputValue(savedCountdown?.targetAt ?? defaultTarget));
    setCountdownError("");
    setIsCountdownOpen(true);
  }

  function closeCountdownForm() {
    setCountdownError("");
    setIsCountdownOpen(false);
  }

  function handleSaveCountdown() {
    const title = countdownTitle.trim();
    const targetAt = combineDateAndTime(countdownDate, "00:00");
    if (!title || !countdownDate) {
      setCountdownError("Add a title and date.");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(targetAt).getTime() < today.getTime()) {
      setCountdownError("Choose today or a future date.");
      return;
    }
    saveCountdownMutation.mutate({
      title,
      targetAt,
      createdAt: savedCountdown?.createdAt ?? new Date().toISOString(),
    });
  }

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
  const openDebts = (debtsQuery.data ?? []).filter((debt) => !debt.paidAt);
  const outstandingDebtTotal = openDebts.reduce((sum, debt) => sum + debt.amount, 0);
  const nextDebt = [...openDebts].sort(
    (left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
  )[0];
  const stacked = width < 820;
  const compact = width < 640;
  const countdownProgress = savedCountdown
    ? calculateCountdownProgress(savedCountdown.targetAt, savedCountdown.createdAt, new Date(countdownNow))
    : { daysRemaining: 0, totalDays: 1, fillPercent: 0, expired: false };
  const countdownExpired = countdownProgress.expired;
  const countdownDays = countdownProgress.daysRemaining;
  const countdownFill = countdownProgress.fillPercent;
  const countdownWaveForwardWebProps = Platform.OS === "web"
    ? ({ dataSet: { countdownWave: "forward" } } as any)
    : {};

  const monthCard = (
    <Card>
      <SectionTitle title={range.title} subtitle={range.subtitle} subtitleMode="inline" />
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
      <View style={styles.list}>
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
      <View style={styles.list}>
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

  const debtCard = (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionTitle title="Debt watcher" subtitle="Upcoming bills and unpaid balances." />
        <PillButton label="View debts" tone="ghost" onPress={() => appShellStore.getState().setTab("debts")} />
      </View>
      <View style={styles.metrics}>
        <Metric label="Open items" value={String(openDebts.length)} />
        <Metric label="Total outstanding" value={formatMoney(outstandingDebtTotal, user?.currency ?? "USD")} />
      </View>
      {nextDebt ? (
        <View style={styles.debtPreview}>
          <View style={styles.debtPreviewText}>
            <Text style={styles.rowTitle}>{nextDebt.merchant}</Text>
            <Text style={styles.rowMeta}>
              {new Date(nextDebt.dueAt).getTime() < Date.now() ? "Overdue, due" : "Next due"} {formatDateTimeLabel(nextDebt.dueAt)}
            </Text>
          </View>
          <Text style={styles.rowAmount}>{formatMoney(nextDebt.amount, user?.currency ?? "USD")}</Text>
        </View>
      ) : (
        <Text style={styles.emptyText}>No unpaid debts.</Text>
      )}
    </Card>
  );

  const countdownCard = (
    <Card style={styles.countdownCard}>
      {savedCountdown ? (
        <View style={[styles.countdownContent, compact && styles.countdownContentCompact]}>
          <View
            style={[
              styles.countdownObject,
              compact && styles.countdownObjectCompact,
              countdownExpired && styles.countdownObjectExpired,
            ]}
            accessibilityLabel={`${countdownFill}% of the countdown remaining`}
          >
            <View
              style={[
                styles.countdownObjectFill,
                countdownExpired && styles.countdownObjectFillExpired,
                { height: `${countdownFill}%` },
              ]}
            >
              <View style={styles.countdownFillBody} />
              <View style={styles.countdownWaveSurface} pointerEvents="none">
                <View {...countdownWaveForwardWebProps} style={styles.countdownWaveTrack}>
                  <Svg width={264} height={34} viewBox="0 0 264 34">
                    <Path
                      d="M0 16 C11 6 22 6 33 16 S55 26 66 16 S88 6 99 16 S121 26 132 16 S154 6 165 16 S187 26 198 16 S220 6 231 16 S253 26 264 16 L264 34 L0 34 Z"
                      fill={theme.colors.accent}
                      opacity={0.32}
                    />
                  </Svg>
                </View>
              </View>
            </View>
            <View style={styles.countdownObjectLabel}>
              <Text
                style={[
                  styles.countdownNumber,
                  compact && styles.countdownNumberCompact,
                  countdownExpired && styles.countdownUrgentText,
                ]}
              >
                {countdownExpired ? "0" : countdownDays}
              </Text>
              <Text
                style={[
                  styles.countdownUnit,
                  compact && styles.countdownUnitCompact,
                  countdownExpired && styles.countdownUrgentText,
                ]}
              >
                {countdownExpired ? "DONE" : countdownDays === 1 ? "DAY" : "DAYS"}
              </Text>
            </View>
          </View>
          <View style={styles.countdownDetails}>
            <Text style={styles.countdownEyebrow}>COUNTDOWN</Text>
            <Text style={styles.countdownTitle} numberOfLines={1}>{savedCountdown.title}</Text>
            <Text style={styles.countdownDate} numberOfLines={1}>{formatDateLabel(savedCountdown.targetAt)}</Text>
          </View>
          <View style={styles.countdownMenu}>
            <Pressable
              accessibilityLabel="Countdown actions"
              accessibilityRole="button"
              accessibilityState={{ expanded: isCountdownMenuOpen }}
              onPress={() => setIsCountdownMenuOpen((open) => !open)}
              style={[styles.countdownMenuButton, isCountdownMenuOpen && styles.countdownMenuButtonOpen]}
            >
              <Text style={[styles.countdownMenuDots, isCountdownMenuOpen && styles.countdownMenuDotsOpen]}>•••</Text>
            </Pressable>
            {isCountdownMenuOpen ? (
              <View style={styles.countdownMenuPopover}>
                <Pressable
                  accessibilityRole="button"
                  onPress={openCountdownForm}
                  style={styles.countdownMenuItem}
                >
                  <Text style={styles.countdownMenuItemText}>Edit</Text>
                </Pressable>
                <View style={styles.countdownMenuDivider} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setIsCountdownMenuOpen(false);
                    deleteCountdownMutation.mutate();
                  }}
                  style={styles.countdownMenuItem}
                >
                  <Text style={[styles.countdownMenuItemText, styles.countdownMenuRemoveText]}>Remove</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.countdownEmpty}>
          <View>
            <Text style={styles.countdownEyebrow}>COUNTDOWN</Text>
            <Text style={styles.emptyText}>Add a title and date to start.</Text>
          </View>
          <PillButton label="Add countdown" tone="ghost" onPress={openCountdownForm} />
        </View>
      )}
      {countdownSyncError ? <Text style={styles.errorText}>{countdownSyncError}</Text> : null}
    </Card>
  );

  const merchantSuggestions = [...historyTransactions]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .reduce<Array<{ merchant: string; categoryId: string | null }>>((saved, transaction) => {
      const merchant = transaction.merchant?.trim() ?? "";
      if (merchant && !saved.some((item) => item.merchant.toLowerCase() === merchant.toLowerCase())) {
        saved.push({ merchant, categoryId: transaction.categoryId ?? null });
      }
      return saved;
    }, []);

  return (
    <View style={styles.screen}>
      <ScreenContainer
        screenKey="home"
        fabSafeInset
        refreshing={isRefreshing}
        onRefresh={async () => {
          setIsRefreshing(true);
          try {
            await Promise.all([categoriesQuery.refetch(), transactionsQuery.refetch(), historyQuery.refetch(), budgetsQuery.refetch(), debtsQuery.refetch()]);
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
            {countdownCard}
            {debtCard}
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
              {debtCard}
              {countdownCard}
              {topCategoriesCard}
            </View>
          </View>
        )}
      </ScreenContainer>

      <Pressable style={[styles.fab, compact && styles.fabCompact]} onPress={() => setIsQuickAddOpen(true)}>
        <Text style={styles.fabPlus}>+</Text>
        <Text style={[styles.fabLabel, compact && styles.fabLabelCompact]}>Add transaction</Text>
      </Pressable>

      <FormModal visible={isQuickAddOpen} title="Quick add" onClose={() => setIsQuickAddOpen(false)} size="wide">
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
      </FormModal>

      <FormModal
        visible={isCountdownOpen}
        title={savedCountdown ? "Edit countdown" : "Add countdown"}
        subtitle="Choose an event and its date."
        onClose={closeCountdownForm}
        footer={<PillButton label="Save countdown" onPress={handleSaveCountdown} />}
      >
        <View style={styles.countdownForm}>
          <View style={styles.countdownField}>
            <Text style={styles.formLabel}>Title</Text>
            <TextInput
              value={countdownTitle}
              onChangeText={setCountdownTitle}
              placeholder="Countdown title"
              placeholderTextColor={theme.colors.muted}
              style={styles.formInput}
            />
          </View>
          <View style={styles.countdownField}>
            <Text style={styles.formLabel}>Date</Text>
            <TextInput
              {...(Platform.OS === "web" ? ({ type: "date" } as any) : {})}
              value={countdownDate}
              onChangeText={setCountdownDate}
              style={styles.formInput}
            />
          </View>
          {countdownError ? <Text style={styles.errorText}>{countdownError}</Text> : null}
        </View>
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  column: {
    gap: theme.spacing.lg,
  },
  columnStackedSafe: {
    marginBottom: 80,
  },
  columnCompactSafe: {
    marginBottom: 60,
  },
  desktopGrid: {
    flexDirection: "row",
    gap: theme.spacing.lg,
    width: "100%",
  },
  desktopColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.lg,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.lg,
  },
  predictionRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
  },
  sectionHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  debtPreview: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.lg,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  debtPreviewText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  countdownCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    overflow: "visible",
    zIndex: 10,
    ...(Platform.OS === "web" ? ({ boxShadow: "none" } as any) : {}),
  },
  countdownContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 24,
    justifyContent: "center",
    width: "100%",
  },
  countdownContentCompact: {
    gap: 12,
    justifyContent: "space-between",
  },
  countdownObject: {
    alignItems: "center",
    backgroundColor: theme.colors.field,
    borderColor: theme.colors.border,
    borderRadius: 28,
    borderWidth: 1,
    height: 132,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 132,
  },
  countdownObjectCompact: {
    borderRadius: 22,
    flexShrink: 0,
    height: 96,
    width: 96,
  },
  countdownObjectExpired: {
    borderColor: theme.colors.warning,
  },
  countdownObjectFill: {
    bottom: 0,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
  },
  countdownObjectFillExpired: {
    opacity: 0,
  },
  countdownFillBody: {
    backgroundColor: theme.colors.accent,
    bottom: 0,
    left: 0,
    opacity: 0.32,
    position: "absolute",
    right: 0,
    top: 34,
  },
  countdownWaveSurface: {
    height: 34,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  countdownWaveTrack: {
    height: 34,
    left: -66,
    position: "absolute",
    top: 0,
    width: 264,
  },
  countdownObjectLabel: {
    alignItems: "center",
    zIndex: 1,
  },
  countdownNumber: {
    color: theme.colors.ink,
    fontSize: 46,
    fontWeight: "900",
    lineHeight: 48,
  },
  countdownNumberCompact: {
    fontSize: 34,
    lineHeight: 36,
  },
  countdownUnit: {
    color: theme.colors.accent,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  countdownUnitCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
  countdownUrgentText: {
    color: theme.colors.warning,
  },
  countdownDetails: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
  },
  countdownEyebrow: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  countdownTitle: {
    color: theme.colors.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
  },
  countdownDate: {
    color: theme.colors.muted,
    ...theme.typography.label,
  },
  countdownMenu: {
    alignSelf: "center",
    flexShrink: 0,
    position: "relative",
    zIndex: 20,
  },
  countdownMenuButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  countdownMenuButtonOpen: {
    backgroundColor: theme.colors.accent,
  },
  countdownMenuDots: {
    color: theme.colors.accentSoftText,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -1,
    lineHeight: 20,
  },
  countdownMenuDotsOpen: {
    color: theme.colors.accentText,
  },
  countdownMenuPopover: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 112,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 46,
    zIndex: 30,
    ...(Platform.OS === "web" ? theme.shadow : {}),
  },
  countdownMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  countdownMenuItemText: {
    color: theme.colors.ink,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
  countdownMenuDivider: {
    backgroundColor: theme.colors.border,
    height: 1,
  },
  countdownMenuRemoveText: {
    color: theme.colors.warning,
  },
  countdownEmpty: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "space-between",
  },
  countdownForm: {
    gap: 14,
    marginBottom: 15,
  },
  countdownField: {
    gap: 8,
  },
  formLabel: {
    color: theme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  formInput: {
    backgroundColor: theme.colors.field,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
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
    ...theme.typography.body,
  },
  predictionValue: {
    color: theme.colors.accent,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
  },
  list: {
    gap: theme.spacing.md,
  },
  quickAddFallback: {
    gap: 12,
    alignItems: "flex-start",
  },
  modalInfo: {
    color: theme.colors.muted,
    ...theme.typography.body,
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
    lineHeight: 22,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  rowMeta: {
    ...theme.typography.label,
    color: theme.colors.muted,
  },
  categoryName: {
    flex: 1,
    justifyContent: "center",
  },
  rowAmount: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: theme.colors.ink,
  },
  errorText: {
    color: theme.colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    paddingVertical: 4,
  },
  emptyText: {
    color: theme.colors.muted,
    ...theme.typography.body,
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
    ...theme.typography.control,
    fontWeight: "700",
  },
  fabLabelCompact: {
    fontSize: 14,
  },
});
