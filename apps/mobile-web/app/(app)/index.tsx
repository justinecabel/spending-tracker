import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildForecastAnalysis, type Category, type CreateCategoryInput, type Transaction } from "@spending-tracker/shared";
import { Card, FormModal, Metric, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import { combineDateAndTime, formatDateLabel, formatDateTimeLabel, formatMoney, toDateInputValue } from "../../src/lib/date";
import { buildSpendingReport, budgetMonthsForRange, mapWithConcurrency, resolveSummaryRange } from "../../src/lib/summary-range";
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
    enabled: !range.error,
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
    enabled: !range.error,
    queryFn: async () => {
      const results = await mapWithConcurrency(
        budgetMonths,
        4,
        async (month) => {
          const cacheId = transactionScopeKey(userId, `budgets:${month}`);
          const cached = offlineCacheStore.getState().budgetsByScope[cacheId];
          try {
            const budgets = await api.budgets(month);
            offlineCacheStore.getState().setBudgets(cacheId, budgets);
            return budgets;
          } catch {
            return cached ?? [];
          }
        },
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
        if (queuedUpdate?.entity === "category" && queuedUpdate.aßÏz¶‰žËkºwµç@€ð½Y¥•Üø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õôø4(€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€…•ÍÍ¥‰¥±¥Ñå1…‰•°ô‰½Õ¹Ñ‘½Ý¸…Ñ¥½¹Ìˆ4(€€€€€€€€€€€€€…•ÍÍ¥‰¥±¥ÑåI½±”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€…•ÍÍ¥‰¥±¥ÑåMÑ…Ñ”õíì•áÁ…¹‘•è¥Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸õô4(€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ%Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸ ¡½Á•¸¤€ôø€…½Á•¸¥ô4(€€€€€€€€€€€€€ÍÑå±”õímÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ	ÕÑÑ½¸°¥Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸€˜˜ÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ	ÕÑÑ½¹=Á•¹uô4(€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õímÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ½ÑÌ°¥Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸€˜˜ÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ½ÑÍ=Á•¹uôûŠ‹Š‹Šˆð½Q•áÐø4(€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€í¥Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸€ü€ 4(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹ÕA½Á½Ù•Éôø4(€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€€€…•ÍÍ¥‰¥±¥ÑåI½±”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõí½Á•¹½Õ¹Ñ‘½Ý¹½Éµô4(€€€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•µô4(€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•µQ•áÑôù‘¥Ðð½Q•áÐø4(€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ¥Ù¥‘•Éô€¼ø4(€€€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€€€…•ÍÍ¥‰¥±¥ÑåI½±”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€€€Í•Ñ%Í½Õ¹Ñ‘½Ý¹5•¹Õ=Á•¸¡™…±Í”¤ì4(€€€€€€€€€€€€€€€€€€€‘•±•Ñ•½Õ¹Ñ‘½Ý¹5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ” ¤ì4(€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•µô4(€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õímÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•µQ•áÐ°ÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹5•¹ÕI•µ½Ù•Q•áÑuôùI•µ½Ù”ð½Q•áÐø4(€€€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€¤€è€ 4(€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹µÁÑåôø4(€€€€€€€€€€ñY¥•Üø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹å•‰É½Ýôù=U9Q=]8ð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•µÁÑåQ•áÑôù‘„Ñ¥Ñ±”…¹‘…Ñ”Ñ¼ÍÑ…ÉÐ¸ð½Q•áÐø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ñA¥±±	ÕÑÑ½¸±…‰•°ô‰‘½Õ¹Ñ‘½Ý¸ˆÑ½¹”ô‰¡½ÍÐˆ½¹AÉ•ÍÌõí½Á•¹½Õ¹Ñ‘½Ý¹½Éµô€¼ø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€¥ô4(€€€€€í½Õ¹Ñ‘½Ý¹Må¹ÉÉ½È€ü€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•ÉÉ½ÉQ•áÑôùí½Õ¹Ñ‘½Ý¹Må¹ÉÉ½Éôð½Q•áÐø€è¹Õ±±ô4(€€€€ð½…Éø4(€€¤ì4(4(€½¹ÍÐµ•É¡…¹ÑMÕ•ÍÑ¥½¹Ì€ôl¸¸¹¡¥ÍÑ½ÉåQÉ…¹Í…Ñ¥½¹Ít4(€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø¹•Ü…Ñ”¡É¥¡Ð¹½ÕÉÉ•‘Ð¤¹•ÑQ¥µ” ¤€´¹•Ü…Ñ”¡±•™Ð¹½ÕÉÉ•‘Ð¤¹•ÑQ¥µ” ¤¤4(€€€€¹É•‘Õ”ñÉÉ…äñìµ•É¡…¹ÐèÍÑÉ¥¹œì…Ñ•½Éå%èÍÑÉ¥¹œð¹Õ±°ôøø ¡Í…Ù•°ÑÉ…¹Í…Ñ¥½¸¤€ôøì4(€€€€€½¹ÍÐµ•É¡…¹Ð€ôÑÉ…¹Í…Ñ¥½¸¹µ•É¡…¹Ðü¹ÑÉ¥´ ¤€üü€ˆˆì4(€€€€€¥˜€¡µ•É¡…¹Ð€˜˜€…Í…Ù•¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹µ•É¡…¹Ð¹Ñ½1½Ý•É…Í” ¤€ôôôµ•É¡…¹Ð¹Ñ½1½Ý•É…Í” ¤¤¤ì4(€€€€€€€Í…Ù•¹ÁÕÍ ¡ìµ•É¡…¹Ð°…Ñ•½Éå%èÑÉ…¹Í…Ñ¥½¸¹…Ñ•½Éå%€üü¹Õ±°ô¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸Í…Ù•ì4(€€€ô°mt¤ì4(4(€É•ÑÕÉ¸€ 4(€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹ÍÉ••¹ôø4(€€€€€€ñMÉ••¹½¹Ñ…¥¹•È4(€€€€€€€ÍÉ••¹-•äô‰¡½µ”ˆ4(€€€€€€€™…‰M…™•%¹Í•Ð4(€€€€€€€É•™É•Í¡¥¹œõí¥ÍI•™É•Í¡¥¹ô4(€€€€€€€½¹I•™É•Í õí…Íå¹Œ€ ¤€ôøì4(€€€€€€€€€Í•Ñ%ÍI•™É•Í¡¥¹œ¡ÑÉÕ”¤ì4(€€€€€€€€€ÑÉäì4(€€€€€€€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m…Ñ•½É¥•ÍEÕ•Éä¹É•™•Ñ  ¤°ÑÉ…¹Í…Ñ¥½¹ÍEÕ•Éä¹É•™•Ñ  ¤°¡¥ÍÑ½ÉåEÕ•Éä¹É•™•Ñ  ¤°‰Õ‘•ÑÍEÕ•Éä¹É•™•Ñ  ¤°‘•‰ÑÍEÕ•Éä¹É•™•Ñ  ¥t¤ì4(€€€€€€€€€ô™¥¹…±±äì4(€€€€€€€€€€€Í•Ñ%ÍI•™É•Í¡¥¹œ¡™…±Í”¤ì4(€€€€€€€€€ô4(€€€€€€€õô4(€€€€€€ø4(€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰MÕµµ…Éäˆ€¼ø4(€€€€€€€íÍÑ…­•€ü€ 4(€€€€€€€€€€ñY¥•ÜÍÑå±”õímÍÑå±•Ì¹½±Õµ¸°ÍÑå±•Ì¹½±Õµ¹MÑ…­•‘M…™”°½µÁ…Ð€˜˜ÍÑå±•Ì¹½±Õµ¹½µÁ…ÑM…™•uôø4(€€€€€€€€€€€íµ½¹Ñ¡…É‘ô4(€€€€€€€€€€€íÁÉ•‘¥Ñ¥½¹…É‘ô4(€€€€€€€€€€€í½Õ¹Ñ‘½Ý¹…É‘ô4(€€€€€€€€€€€í‘•‰Ñ…É‘ô4(€€€€€€€€€€€íÉ••¹Ñ…É‘ô4(€€€€€€€€€€€íÑ½Á…Ñ•½É¥•Í…É‘ô4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€¤€è€ 4(€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘•Í­Ñ½ÁÉ¥‘ôø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘•Í­Ñ½Á½±Õµ¹ôø4(€€€€€€€€€€€€€íµ½¹Ñ¡…É‘ô4(€€€€€€€€€€€€€íÁÉ•‘¥Ñ¥½¹…É‘ô4(€€€€€€€€€€€€€íÉ••¹Ñ…É‘ô4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘•Í­Ñ½Á½±Õµ¹ôø4(€€€€€€€€€€€€€í‘•‰Ñ…É‘ô4(€€€€€€€€€€€€€í½Õ¹Ñ‘½Ý¹…É‘ô4(€€€€€€€€€€€€€íÑ½Á…Ñ•½É¥•Í…É‘ô4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€¥ô4(€€€€€€ð½MÉ••¹½¹Ñ…¥¹•Èø4(4(€€€€€€ñAÉ•ÍÍ…‰±”ÍÑå±”õímÍÑå±•Ì¹™…ˆ°½µÁ…Ð€˜˜ÍÑå±•Ì¹™…‰½µÁ…Ñuô½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ%ÍEÕ¥­‘‘=Á•¸¡ÑÉÕ”¥ôø4(€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹™…‰A±ÕÍôø¬ð½Q•áÐø4(€€€€€€€€ñQ•áÐÍÑå±”õímÍÑå±•Ì¹™…‰1…‰•°°½µÁ…Ð€˜˜ÍÑå±•Ì¹™…‰1…‰•±½µÁ…Ñuôù‘ÑÉ…¹Í…Ñ¥½¸ð½Q•áÐø4(€€€€€€ð½AÉ•ÍÍ…‰±”ø4(4(€€€€€€ñ½Éµ5½‘…°Ù¥Í¥‰±”õí¥ÍEÕ¥­‘‘=Á•¹ôÑ¥Ñ±”ô‰EÕ¥¬…‘ˆ½¹±½Í”õì ¤€ôøÍ•Ñ%ÍEÕ¥­‘‘=Á•¸¡™…±Í”¥ôÍ¥é”ô‰Ý¥‘”ˆø4(€€€€€€€€€€€í…Ñ•½É¥•ÍEÕ•Éä¹¥ÍA•¹‘¥¹œ€ü€ 4(€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±%¹™½ôù1½…‘¥¹œ…Ñ•½É¥•Ì¸¸¸ð½Q•áÐø4(€€€€€€€€€€€€¤€è…Ñ•½É¥•ÍEÕ•Éä¹•ÉÉ½È€ü€ 4(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹ÅÕ¥­‘‘…±±‰…­ôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•ÉÉ½ÉQ•áÑôùí…Ñ•½É¥•ÍEÕ•Éä¹•ÉÉ½È¹µ•ÍÍ…•ôð½Q•áÐø4(€€€€€€€€€€€€€€€€ñA¥±±	ÕÑÑ½¸4(€€€€€€€€€€€€€€€€€±…‰•°ô‰I•ÑÉäˆ4(€€€€€€€€€€€€€€€€€Ñ½¹”ô‰¡½ÍÐˆ4(€€€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€€€Ù½¥…Ñ•½É¥•ÍEÕ•Éä¹É•™•Ñ  ¤ì4(€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€ñQÉ…¹Í…Ñ¥½¹½É´4(€€€€€€€€€€€€€€€…Ñ•½É¥•Ìõí…Ñ•½É¥•ÍEÕ•Éä¹‘…Ñ„€üümuô4(€€€€€€€€€€€€€€€µ•É¡…¹ÑMÕ•ÍÑ¥½¹Ìõíµ•É¡…¹ÑMÕ•ÍÑ¥½¹Íô4(€€€€€€€€€€€€€€€½¹MÕ‰µ¥Ðõí…Íå¹Œ€¡¥¹ÁÕÐ¤€ôøì4(€€€€€€€€€€€€€€€€€…Ý…¥Ð¡…¹‘±•É•…Ñ•QÉ…¹Í…Ñ¥½¸¡¥¹ÁÕÐ¤ì4(€€€€€€€€€€€€€€€€€Í•Ñ%ÍEÕ¥­‘‘=Á•¸¡™…±Í”¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€½¹É•…Ñ•…Ñ•½Éäõì¡ì¹…µ”°½±½Èô¤€ôø4(€€€€€€€€€€€€€€€€€¡…¹‘±•É•…Ñ•…Ñ•½Éä¡ì4(€€€€€€€€€€€€€€€€€€€¹…µ”°4(€€€€€€€€€€€€€€€€€€€½±½È°4(€€€€€€€€€€€€€€€€€€€¥½¸è€‰Ý…±±•Ðˆ°4(€€€€€€€€€€€€€€€€€€€­¥¹è€‰•áÁ•¹Í”ˆ°4(€€€€€€€€€€€€€€€€€ô¤4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€½¹UÁ‘…Ñ•…Ñ•½Éäõì¡¥°‘…Ñ„¤€ôø4(€€€€€€€€€€€€€€€€€¡…¹‘±•UÁ‘…Ñ•…Ñ•½Éä¡¥°‘…Ñ„¤4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€½¹•±•Ñ•…Ñ•½Éäõí¡…¹‘±••±•Ñ•…Ñ•½Éåô4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€¥ô4(€€€€€€ð½½Éµ5½‘…°ø4(4(€€€€€€ñ½Éµ5½‘…°4(€€€€€€€Ù¥Í¥‰±”õí¥Í½Õ¹Ñ‘½Ý¹=Á•¹ô4(€€€€€€€Ñ¥Ñ±”õíÍ…Ù•‘½Õ¹Ñ‘½Ý¸€ü€‰‘¥Ð½Õ¹Ñ‘½Ý¸ˆ€è€‰‘½Õ¹Ñ‘½Ý¸‰ô4(€€€€€€€ÍÕ‰Ñ¥Ñ±”ô‰¡½½Í”…¸•Ù•¹Ð…¹¥ÑÌ‘…Ñ”¸ˆ4(€€€€€€€½¹±½Í”õí±½Í•½Õ¹Ñ‘½Ý¹½Éµô4(€€€€€€€™½½Ñ•ÈõìñA¥±±	ÕÑÑ½¸±…‰•°ô‰M…Ù”½Õ¹Ñ‘½Ý¸ˆ½¹AÉ•ÍÌõí¡…¹‘±•M…Ù•½Õ¹Ñ‘½Ý¹ô€¼ùô4(€€€€€€ø4(€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹½Éµôø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹¥•±‘ôø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹™½Éµ1…‰•±ôùQ¥Ñ±”ð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÑ%¹ÁÕÐ4(€€€€€€€€€€€€€Ù…±Õ”õí½Õ¹Ñ‘½Ý¹Q¥Ñ±•ô4(€€€€€€€€€€€€€½¹¡…¹•Q•áÐõíÍ•Ñ½Õ¹Ñ‘½Ý¹Q¥Ñ±•ô4(€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰½Õ¹Ñ‘½Ý¸Ñ¥Ñ±”ˆ4(€€€€€€€€€€€€€Á±…•¡½±‘•ÉQ•áÑ½±½ÈõíÑ¡•µ”¹½±½ÉÌ¹µÕÑ•‘ô4(€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹™½Éµ%¹ÁÕÑô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹½Õ¹Ñ‘½Ý¹¥•±‘ôø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹™½Éµ1…‰•±ôù…Ñ”ð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÑ%¹ÁÕÐ4(€€€€€€€€€€€€€ì¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ìÑåÁ”è€‰‘…Ñ”ˆô…Ì…¹ä¤€èíô¥ô4(€€€€€€€€€€€€€Ù…±Õ”õí½Õ¹Ñ‘½Ý¹…Ñ•ô4(€€€€€€€€€€€€€½¹¡…¹•Q•áÐõíÍ•Ñ½Õ¹Ñ‘½Ý¹…Ñ•ô4(€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹™½Éµ%¹ÁÕÑô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€í½Õ¹Ñ‘½Ý¹ÉÉ½È€ü€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•ÉÉ½ÉQ•áÑôùí½Õ¹Ñ‘½Ý¹ÉÉ½Éôð½Q•áÐø€è¹Õ±±ô4(€€€€€€€€ð½Y¥•Üø4(€€€€€€ð½½Éµ5½‘…°ø4(€€€€ð½Y¥•Üø4(€€¤ì4)ô4(4)½¹ÍÐÍÑå±•Ì€ôMÑå±•M¡••Ð¹É•…Ñ”¡ì4(€ÍÉ••¸èì4(€€€™±•àè€Ä°4(€ô°4(€½±Õµ¸èì4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹±œ°4(€ô°4(€½±Õµ¹MÑ…­•‘M…™”èì4(€€€µ…É¥¹	½ÑÑ½´è€àÀ°4(€ô°4(€½±Õµ¹½µÁ…ÑM…™”èì4(€€€µ…É¥¹	½ÑÑ½´è€ØÀ°4(€ô°4(€‘•Í­Ñ½ÁÉ¥èì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹±œ°4(€€€Ý¥‘Ñ è€ˆÄÀÀ”ˆ°4(€ô°4(€‘•Í­Ñ½Á½±Õµ¸èì4(€€€™±•àè€Ä°4(€€€µ¥¹]¥‘Ñ è€À°4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹±œ°4(€ô°4(€µ•ÑÉ¥Ìèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹±œ°4(€ô°4(€ÁÉ•‘¥Ñ¥½¹I½Üèì4(€€€…±¥¹%Ñ•µÌè€‰™±•àµ•¹ˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄØ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€ô°4(€Í•Ñ¥½¹!•…‘•Èèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€€€…±¥¹%Ñ•µÌè€‰™±•àµÍÑ…ÉÐˆ°4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹µ°4(€ô°4(€‘•‰ÑAÉ•Ù¥•Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹±œ°4(€€€Á…‘‘¥¹Q½Àè€ÄÐ°4(€€€‰½É‘•ÉQ½Á]¥‘Ñ è€Ä°4(€€€‰½É‘•ÉQ½Á½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€ô°4(€‘•‰ÑAÉ•Ù¥•ÝQ•áÐèì4(€€€™±•àè€Ä°4(€€€µ¥¹]¥‘Ñ è€À°4(€€€…Àè€Ì°4(€ô°4(€½Õ¹Ñ‘½Ý¹…Éèì4(€€€‰…­É½Õ¹‘½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°4(€€€‰½É‘•É]¥‘Ñ è€À°4(€€€½Ù•É™±½Üè€‰Ù¥Í¥‰±”ˆ°4(€€€é%¹‘•àè€ÄÀ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì‰½áM¡…‘½Üè€‰¹½¹”ˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€½Õ¹Ñ‘½Ý¹½¹Ñ•¹Ðèì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…Àè€ÈÐ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€€€Ý¥‘Ñ è€ˆÄÀÀ”ˆ°4(€ô°4(€½Õ¹Ñ‘½Ý¹½¹Ñ•¹Ñ½µÁ…Ðèì4(€€€…Àè€ÄÈ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•Ðèì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌè€Èà°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€¡•¥¡Ðè€ÄÌÈ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°4(€€€Á½Í¥Ñ¥½¸è€‰É•±…Ñ¥Ù”ˆ°4(€€€Ý¥‘Ñ è€ÄÌÈ°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•Ñ½µÁ…Ðèì4(€€€‰½É‘•ÉI…‘¥ÕÌè€ÈÈ°4(€€€™±•áM¡É¥¹¬è€À°4(€€€¡•¥¡Ðè€äØ°4(€€€Ý¥‘Ñ è€äØ°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•ÑáÁ¥É•èì4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•Ñ¥±°èì4(€€€‰½ÑÑ½´è€À°4(€€€±•™Ðè€À°4(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€É¥¡Ðè€À°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•Ñ¥±±áÁ¥É•èì4(€€€½Á…¥Ñäè€À°4(€ô°4(€½Õ¹Ñ‘½Ý¹¥±±	½‘äèì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€€€‰½ÑÑ½´è€À°4(€€€±•™Ðè€À°4(€€€½Á…¥Ñäè€À¸ÌÈ°4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€É¥¡Ðè€À°4(€€€Ñ½Àè€ÌÐ°4(€ô°4(€½Õ¹Ñ‘½Ý¹]…Ù•MÕÉ™…”èì4(€€€¡•¥¡Ðè€ÌÐ°4(€€€±•™Ðè€À°4(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€É¥¡Ðè€À°4(€€€Ñ½Àè€À°4(€ô°4(€½Õ¹Ñ‘½Ý¹]…Ù•QÉ…¬èì4(€€€¡•¥¡Ðè€ÌÐ°4(€€€±•™Ðè€´ØØ°4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€Ñ½Àè€À°4(€€€Ý¥‘Ñ è€ÈØÐ°4(€ô°4(€½Õ¹Ñ‘½Ý¹=‰©•Ñ1…‰•°èì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€é%¹‘•àè€Ä°4(€ô°4(€½Õ¹Ñ‘½Ý¹9Õµ‰•Èèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÐØ°4(€€€™½¹Ñ]•¥¡Ðè€ˆäÀÀˆ°4(€€€±¥¹•!•¥¡Ðè€Ðà°4(€ô°4(€½Õ¹Ñ‘½Ý¹9Õµ‰•É½µÁ…Ðèì4(€€€™½¹ÑM¥é”è€ÌÐ°4(€€€±¥¹•!•¥¡Ðè€ÌØ°4(€ô°4(€½Õ¹Ñ‘½Ý¹U¹¥Ðèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€€€™½¹ÑM¥é”è€ÄÈ°4(€€€±¥¹•!•¥¡Ðè€ÄÜ°4(€€€™½¹Ñ]•¥¡Ðè€ˆäÀÀˆ°4(€€€±•ÑÑ•ÉMÁ…¥¹œè€Ä¸È°4(€ô°4(€½Õ¹Ñ‘½Ý¹U¹¥Ñ½µÁ…Ðèì4(€€€™½¹ÑM¥é”è€ÄÀ°4(€€€±¥¹•!•¥¡Ðè€ÄÐ°4(€ô°4(€½Õ¹Ñ‘½Ý¹UÉ•¹ÑQ•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€ô°4(€½Õ¹Ñ‘½Ý¹•Ñ…¥±Ìèì4(€€€™±•àè€Ä°4(€€€™±•áM¡É¥¹¬è€Ä°4(€€€…Àè€Ð°4(€€€µ¥¹]¥‘Ñ è€À°4(€ô°4(€½Õ¹Ñ‘½Ý¹å•‰É½Üèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€™½¹ÑM¥é”è€ÄÈ°4(€€€±¥¹•!•¥¡Ðè€ÄÜ°4(€€€™½¹Ñ]•¥¡Ðè€ˆäÀÀˆ°4(€€€±•ÑÑ•ÉMÁ…¥¹œè€Ä¸Ä°4(€ô°4(€½Õ¹Ñ‘½Ý¹Q¥Ñ±”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÈÀ°4(€€€±¥¹•!•¥¡Ðè€ÈØ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€ô°4(€½Õ¹Ñ‘½Ý¹…Ñ”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹±…‰•°°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Ôèì4(€€€…±¥¹M•±˜è€‰•¹Ñ•Èˆ°4(€€€™±•áM¡É¥¹¬è€À°4(€€€Á½Í¥Ñ¥½¸è€‰É•±…Ñ¥Ù”ˆ°4(€€€é%¹‘•àè€ÈÀ°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ	ÕÑÑ½¸èì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑM½™Ð°4(€€€‰½É‘•ÉI…‘¥ÕÌè€ÈÀ°4(€€€¡•¥¡Ðè€ÐÀ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€€€Ý¥‘Ñ è€ÐÀ°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ	ÕÑÑ½¹=Á•¸èì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ½ÑÌèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑM½™ÑQ•áÐ°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€™½¹Ñ]•¥¡Ðè€ˆäÀÀˆ°4(€€€±•ÑÑ•ÉMÁ…¥¹œè€´Ä°4(€€€±¥¹•!•¥¡Ðè€ÈÀ°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ½ÑÍ=Á•¸èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑQ•áÐ°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹ÕA½Á½Ù•Èèì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…É°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌè€ÄÐ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€µ¥¹]¥‘Ñ è€ÄÄÈ°4(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€É¥¡Ðè€À°4(€€€Ñ½Àè€ÐØ°4(€€€é%¹‘•àè€ÌÀ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€üÑ¡•µ”¹Í¡…‘½Ü€èíô¤°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•´èì4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄØ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ%Ñ•µQ•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄÐ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€€€±¥¹•!•¥¡Ðè€Äà°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹Õ¥Ù¥‘•Èèì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€¡•¥¡Ðè€Ä°4(€ô°4(€½Õ¹Ñ‘½Ý¹5•¹ÕI•µ½Ù•Q•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€ô°4(€½Õ¹Ñ‘½Ý¹µÁÑäèì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÐ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€ô°4(€½Õ¹Ñ‘½Ý¹½É´èì4(€€€…Àè€ÄÐ°4(€€€µ…É¥¹	½ÑÑ½´è€ÄÔ°4(€ô°4(€½Õ¹Ñ‘½Ý¹¥•±èì4(€€€…Àè€à°4(€ô°4(€™½Éµ1…‰•°èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄÐ°4(€€€±¥¹•!•¥¡Ðè€ÈÀ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€™½Éµ%¹ÁÕÐèì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì½ÕÑ±¥¹•]¥‘Ñ è€À°½ÕÑ±¥¹•½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€ÁÉ•‘¥Ñ¥½¹5•Ñ…I½Üèì4(€€€…±¥¹%Ñ•µÌè€‰™±•àµÍÑ…ÉÐˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…Àè€ÄÀ°4(€€€™±•àè€Ä°4(€€€µ¥¹]¥‘Ñ è€À°4(€ô°4(€ÁÉ•‘¥Ñ¥½¹5•Ñ„èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€™±•áM¡É¥¹¬è€Ä°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹‰½‘ä°4(€ô°4(€ÁÉ•‘¥Ñ¥½¹Y…±Õ”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€€€™½¹ÑM¥é”è€ÌÐ°4(€€€±¥¹•!•¥¡Ðè€ÐÀ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€ô°4(€±¥ÍÐèì4(€€€…ÀèÑ¡•µ”¹ÍÁ…¥¹œ¹µ°4(€ô°4(€ÅÕ¥­‘‘…±±‰…¬èì4(€€€…Àè€ÄÈ°4(€€€…±¥¹%Ñ•µÌè€‰™±•àµÍÑ…ÉÐˆ°4(€ô°4(€µ½‘…±%¹™¼èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹‰½‘ä°4(€ô°4(€É½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€à°4(€€€‰½É‘•É	½ÑÑ½µ]¥‘Ñ è€Ä°4(€€€‰½É‘•É	½ÑÑ½µ½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€ô°4(€É½Ý1…ÍÐèì4(€€€‰½É‘•É	½ÑÑ½µ]¥‘Ñ è€À°4(€ô°4(€Á•¹‘¥¹I½Üèì4(€€€‰…­É½Õ¹‘½±½Èè€‰É‰„ ÄäÐ°€ØÔ°€ÄÈ°€À¸ÄÀ¤ˆ°4(€€€‰½É‘•É1•™Ñ½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€€€‰½É‘•É1•™Ñ]¥‘Ñ è€Ì°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹Í´°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÀ°4(€ô°4(€É½ÝQ¥Ñ±”èì4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€±¥¹•!•¥¡Ðè€ÈÈ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€ô°4(€É½Ý5•Ñ„èì4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹±…‰•°°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€ô°4(€…Ñ•½Éå9…µ”èì4(€€€™±•àè€Ä°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€ô°4(€É½Ýµ½Õ¹Ðèì4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€±¥¹•!•¥¡Ðè€ÈÈ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€ô°4(€•ÉÉ½ÉQ•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€€€™½¹ÑM¥é”è€ÄÐ°4(€€€±¥¹•!•¥¡Ðè€ÈÀ°4(€ô°4(€•µÁÑåMÑ…Ñ”èì4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€Ð°4(€ô°4(€•µÁÑåQ•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹‰½‘ä°4(€ô°4(€™…ˆèì4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€É¥¡Ðè€ÈÀ°4(€€€‰½ÑÑ½´è€ÈÐ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€…Àè€ÄÀ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€€€‰½É‘•ÉI…‘¥ÕÌè€äää°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Äà°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÐ°4(€€€€¸¸¹Ñ¡•µ”¹Í¡…‘½Ü°4(€ô°4(€™…‰½µÁ…Ðèì4(€€€±•™Ðè€ÄÈ°4(€€€É¥¡Ðè€ÄÈ°4(€€€‰½ÑÑ½´è€ÄÈ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€™…‰A±ÕÌèì4(€€€½±½Èè€ˆˆ°4(€€€™½¹ÑM¥é”è€ÈÈ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€€€±¥¹•!•¥¡Ðè€ÈÈ°4(€ô°4(€™…‰1…‰•°èì4(€€€½±½Èè€ˆˆ°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹½¹ÑÉ½°°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€™…‰1…‰•±½µÁ…Ðèì4(€€€™½¹ÑM¥é”è€ÄÐ°4(€ô°4)ô¤ì4