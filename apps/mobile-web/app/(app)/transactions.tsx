import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal, Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { Transaction } from "@spending-tracker/shared";
import { Card, PageHeader, PillButton } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import {
  combineDateAndTime,
  formatDateTimeLabel,
  formatMoney,
  toDateInputValue,
  toTimeInputValue,
} from "../../src/lib/date";
import { draftTransactionsStore } from "../../src/state/draft-transactions";
import { offlineCacheStore, transactionScopeKey } from "../../src/state/offline-cache";
import { offlineQueueStore } from "../../src/state/offline-queue";
import { sessionStore } from "../../src/state/session";
import { summaryRangeStore } from "../../src/state/summary-range";
import { appShellStore } from "../../src/state/app-shell";
import { resolveSummaryRange } from "../../src/lib/summary-range";
import { theme } from "../../src/theme";
import { WebPressable as Pressable } from "../../src/components/web-pressable";
import { nanoid } from "nanoid/non-secure";

function normalizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) {
    return cleaned;
  }
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("network") || message.includes("fetch");
}

export default function TransactionsScreen() {
  const { width } = useWindowDimensions();
  const compactDateTime = width < 420;
  const user = sessionStore((state) => state.user);
  const drafts = draftTransactionsStore((state) => state.drafts);
  const removeDraftByClientId = draftTransactionsStore((state) => state.removeDraftByClientId);
  const removeQueuedMutationByClientId = offlineQueueStore((state) => state.removeByClientId);
  const enqueue = offlineQueueStore((state) => state.enqueue);
  const queuedMutations = offlineQueueStore((state) => state.mutations);
  const queryClient = useQueryClient();
  const userId = user?.id ?? "anonymous";
  const summaryMode = summaryRangeStore((state) => state.mode);
  const customFrom = summaryRangeStore((state) => state.customFrom);
  const customTo = summaryRangeStore((state) => state.customTo);
  const smartPaydays = summaryRangeStore((state) => state.smartPaydays);
  const range = resolveSummaryRange({ mode: summaryMode, customFrom, customTo, smartPaydays });
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  const transactionToView = appShellStore((state) => state.transactionToView);
  const clearTransactionToView = appShellStore((state) => state.clearTransactionToView);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingDeleteTransaction, setPendingDeleteTransaction] = useState<Transaction | null>(null);
  const webAmountInputProps = Platform.OS === "web" ? ({ inputMode: "decimal" } as const) : {};
  const webDateInputProps = Platform.OS === "web" ? ({ type: "date" } as const) : {};
  const webTimeInputProps = Platform.OS === "web" ? ({ type: "time" } as const) : {};

  const categoriesQuery = useQuery({
    queryKey: ["categories", userId],
    queryFn: async () => {
      const cached = offlineCacheStore.getState().categoriesByUser[userId];
      try {
        const categories = await api.categories();
        offlineCacheStore.getState().setCategories(userId, categories);
        return categories;
      } catch (error) {
        if (cached) {
          return cached;
        }
        throw error;
      }
    },
  });

  const transactionCacheId = transactionScopeKey(userId, `transactions:${range.key}`);
  const transactionsQuery = useQuery({
    queryKey: ["transactions", userId, "all", range.key],
    queryFn: async () => {
      const cached = offlineCacheStore.getState().transactionsByScope[transactionCacheId];
      try {
        const transactions = await api.transactions({
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        });
        offlineCacheStore.getState().setTransactions(transactionCacheId, transactions);
        return transactions;
      } catch (error) {
        if (cached) {
          return cached;
        }
        throw error;
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["report"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateTransaction>[1] }) =>
      api.updateTransaction(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["report"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setSelectedTransaction(null);
    },
  });

  const categories = (categoriesQuery.data ?? []).filter(
    (category) =>
      category.kind === "expense" &&
      !category.archived &&
      !category.isSystem &&
      !["other", "trashed"].includes(category.name.trim().toLowerCase()),
  );
  const categoryNameById = new Map((categoriesQuery.data ?? []).map((category) => [category.id, category.name]));

  const transactions = [
    ...drafts.filter((transaction) => {
      if (transaction.userId !== userId) return false;
      if (range.from && transaction.occurredAt < range.from) return false;
      if (range.to && transaction.occurredAt > range.to) return false;
      return true;
    }),
    ...(transactionsQuery.data ?? []),
  ].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());

  function queueUpdate(id: string, data: Parameters<typeof api.updateTransaction>[1]) {
    offlineCacheStore.getState().updateTransaction(userId, id, data);
    enqueue({
      id: nanoid(),
      userId,
      entity: "transaction",
      action: "update",
      payload: { id, data },
      createdAt: new Date().toISOString(),
    });
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["report"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    setSelectedTransaction(null);
  }

  function queueDelete(id: string) {
    offlineCacheStore.getState().removeTransaction(userId, id);
    enqueue({
      id: nanoid(),
      userId,
      entity: "transaction",
      action: "delete",
      payload: { id },
      createdAt: new Date().toISOString(),
    });
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["report"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    setPendingDeleteTransaction(null);
  }

  async function handleUpdate(id: string, data: Parameters<typeof api.updateTransaction>[1]) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      queueUpdate(id, data);
      return;
    }

    try {
      await updateMutation.mutateAsync({ id, data });
    } catch (error) {
      if (isNetworkError(error)) {
        queueUpdate(id, data);
      }
    }
  }

  async function handleDelete(id: string) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      queueDelete(id);
      return;
    }

    try {
      await deleteMutation.mutateAsync(id);
      setPendingDeleteTransaction(null);
    } catch (error) {
      if (isNetworkError(error)) {
        queueDelete(id);
      }
    }
  }

  useEffect(() => {
    if (!transactionToView) {
      return;
    }

    const transaction = transactions.find((item) => item.id === transactionToView);
    if (transaction) {
      setViewingTransaction(transaction);
      clearTransactionToView();
    }
  }, [clearTransactionToView, transactionToView, transactions]);

  useEffect(() => {
    if (!selectedTransaction) {
      return;
    }

    if (!categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? "");
    }
  }, [categories, categoryId, selectedTransaction]);

  function openEditor(transaction: Transaction) {
    updateMutation.reset();
    setSelectedTransaction(transaction);
    setAmount(String(transaction.amount));
    setMerchant(transaction.merchant ?? "");
    setNote(transaction.note ?? "");
    setDateValue(toDateInputValue(transaction.occurredAt));
    setTimeValue(toTimeInputValue(transaction.occurredAt));
    setCategoryId(transaction.categoryId);
  }

  return (
    <ScreenContainer
      screenKey="transactions"
      refreshing={isRefreshing}
      onRefresh={async () => {
        setIsRefreshing(true);
        try {
          await Promise.all([categoriesQuery.refetch(), transactionsQuery.refetch()]);
        } finally {
          setIsRefreshing(false);
        }
      }}
    >
      <PageHeader title="Transactions" />
      <Card>
        <View style={styles.list}>
          {transactions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No transactions yet. Your saved expenses will show up here once you add one.</Text>
            </View>
          ) : (
            transactions.map((transaction, index, items) => {
            const isDraft = transaction.id.startsWith("client-");
            const isPendingSync = isDraft || queuedMutations.some((mutation) => {
              const payload = mutation.payload as { id?: string; clientId?: string };
              return payload.id === transaction.id || payload.clientId === transaction.id;
            });

            return (
              <View key={transaction.id} style={[styles.row, isPendingSync && styles.pendingRow, index === items.length - 1 && styles.rowLast]}>
                <Pressable
                  style={styles.rowInfo}
                  onPress={() => setViewingTransaction(transaction)}
                >
                  <Text style={styles.title}>{transaction.merchant ?? transaction.note ?? "Transaction"}</Text>
                  <Text style={styles.meta}>
                    {[
                      formatDateTimeLabel(transaction.occurredAt),
                      categoryNameById.get(transaction.categoryId),
                      transaction.kind,
                      isPendingSync ? "Pending sync" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Pressable>
                <View style={styles.rowActions}>
                  <Text style={styles.amount}>{formatMoney(transaction.amount, user?.currency ?? "USD")}</Text>
                  <View style={styles.actionRow}>
                    {!isDraft ? <PillButton label="Edit" tone="ghost" onPress={() => openEditor(transaction)} /> : null}
                    <PillButton label="Delete" tone="ghost" onPress={() => setPendingDeleteTransaction(transaction)} />
                  </View>
                </View>
              </View>
            );
            })
          )}
        </View>
      </Card>

      <Modal transparent visible={Boolean(viewingTransaction)} animationType="fade" onRequestClose={() => setViewingTransaction(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{viewingTransaction?.merchant ?? viewingTransaction?.note ?? "Transaction"}</Text>
            <Text style={styles.detailAmount}>{viewingTransaction ? formatMoney(viewingTransaction.amount, user?.currency ?? "USD") : ""}</Text>
            <View style={styles.detailList}>
              <Text style={styles.detailText}>Date: {viewingTransaction ? formatDateTimeLabel(viewingTransaction.occurredAt) : ""}</Text>
              <Text style={styles.detailText}>Category: {viewingTransaction ? categoryNameById.get(viewingTransaction.categoryId) ?? "Uncategorized" : ""}</Text>
              <Text style={styles.detailText}>Type: {viewingTransaction?.kind ?? "expense"}</Text>
              {viewingTransaction?.note ? <Text style={styles.detailText}>Note: {viewingTransaction.note}</Text> : null}
              {viewingTransaction?.id.startsWith("client-") ? <Text style={styles.detailText}>Status: Pending sync</Text> : null}
            </View>
            <View style={styles.modalActions}>
              <PillButton label="Close" tone="ghost" onPress={() => setViewingTransaction(null)} />
              {viewingTransaction && !viewingTransaction.id.startsWith("client-") ? (
                <PillButton
                  label="Edit"
                  onPress={() => {
                    openEditor(viewingTransaction);
                    setViewingTransaction(null);
                  }}
                />
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={Boolean(selectedTransaction)} animationType="fade" onRequestClose={() => setSelectedTransaction(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit transaction</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Amount</Text>
              <TextInput
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={(value) => setAmount(normalizeAmountInput(value))}
                style={styles.input}
                placeholderTextColor={theme.colors.muted}
                {...webAmountInputProps}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Merchant</Text>
              <TextInput
                placeholder="Optional merchant"
                value={merchant}
                onChangeText={setMerchant}
                style={styles.input}
                placeholderTextColor={theme.colors.muted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Note</Text>
              <TextInput
                placeholder="Optional note"
                value={note}
                onChangeText={setNote}
                style={styles.input}
                placeholderTextColor={theme.colors.muted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>When</Text>
              <View style={[styles.dateTimeRow, compactDateTime && styles.dateTimeRowCompact]}>
                <TextInput
                  placeholder="YYYY-MM-DD"
                  value={dateValue}
                  onChangeText={setDateValue}
                  style={[styles.input, styles.dateInput]}
                  placeholderTextColor={theme.colors.muted}
                  {...webDateInputProps}
                />
                <TextInput
                  placeholder="HH:MM"
                  value={timeValue}
                  onChangeText={setTimeValue}
                  style={[styles.input, styles.timeInput, compactDateTime && styles.timeInputCompact]}
                  placeholderTextColor={theme.colors.muted}
                  {...webTimeInputProps}
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Category</Text>
              <View style={styles.categoryRow}>
                {categories.map((category) => (
                  <Pressable
                    key={category.id}
                    onPress={() => setCategoryId(category.id)}
                    style={[
                      styles.categoryChip,
                      {
                        borderColor: category.color,
                        backgroundColor: categoryId === category.id ? category.color : theme.colors.field,
                      },
                    ]}
                  >
                    <Text style={[styles.categoryText, { color: categoryId === category.id ? "#FFFFFF" : category.color }]}>
                      {category.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {updateMutation.error ? <Text style={styles.errorText}>{updateMutation.error.message}</Text> : null}
            <View style={styles.modalActions}>
              <PillButton label="Cancel" tone="ghost" onPress={() => setSelectedTransaction(null)} />
              <PillButton
                label={updateMutation.isPending ? "Saving..." : "Save changes"}
                onPress={() => {
                  if (!selectedTransaction || !Number(amount) || !categoryId) {
                    return;
                  }
                  void handleUpdate(selectedTransaction.id, {
                      amount: Number(amount),
                      merchant: merchant || null,
                      note: note || null,
                      categoryId,
                      occurredAt: combineDateAndTime(dateValue, timeValue),
                  });
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={Boolean(pendingDeleteTransaction)}
        animationType="fade"
        onRequestClose={() => setPendingDeleteTransaction(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete transaction</Text>
            <Text style={styles.modalBody}>
              Delete {pendingDeleteTransaction?.merchant ?? pendingDeleteTransaction?.note ?? "this transaction"}?
            </Text>
            <View style={styles.modalActions}>
              <PillButton label="Cancel" tone="ghost" onPress={() => setPendingDeleteTransaction(null)} />
              <PillButton
                label={deleteMutation.isPending ? "Deleting..." : "Delete"}
                tone="ghost"
                onPress={() => {
                  if (!pendingDeleteTransaction) {
                    return;
                  }

                  if (pendingDeleteTransaction.id.startsWith("client-")) {
                    removeDraftByClientId(pendingDeleteTransaction.id);
                    removeQueuedMutationByClientId(pendingDeleteTransaction.id);
                    setPendingDeleteTransaction(null);
                    return;
                  }

                  void handleDelete(pendingDeleteTransaction.id);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 14,
    gap: 12,
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  pendingRow: {
    backgroundColor: "rgba(194, 65, 12, 0.10)",
    borderLeftColor: theme.colors.warning,
    borderLeftWidth: 3,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
  },
  rowInfo: {
    gap: 4,
    flex: 1,
  },
  title: {
    fontWeight: "700",
    color: theme.colors.ink,
  },
  meta: {
    color: theme.colors.muted,
  },
  rowActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  amount: {
    fontWeight: "700",
    color: theme.colors.ink,
  },
  detailAmount: {
    color: theme.colors.accent,
    fontSize: 28,
    fontWeight: "800",
  },
  detailList: {
    gap: 8,
  },
  detailText: {
    color: theme.colors.ink,
    lineHeight: 21,
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
    gap: 14,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  modalTitle: {
    color: theme.colors.ink,
    fontSize: 22,
    fontWeight: "700",
  },
  field: {
    gap: 8,
  },
  label: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.colors.field,
    color: theme.colors.ink,
    fontSize: 16,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  dateTimeRow: {
    flexDirection: "row",
    gap: 12,
  },
  dateTimeRowCompact: {
    flexDirection: "column",
  },
  dateInput: {
    flex: 1,
  },
  timeInput: {
    width: 118,
  },
  timeInputCompact: {
    width: "100%",
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  categoryText: {
    fontWeight: "600",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBody: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
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
    fontSize: 15,
  },
});
