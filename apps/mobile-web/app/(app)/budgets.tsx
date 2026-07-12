import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import type { Category } from "@spending-tracker/shared";
import { Card, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { api } from "../../src/lib/api";
import { formatMoney, monthKey } from "../../src/lib/date";
import { sessionStore } from "../../src/state/session";
import { theme } from "../../src/theme";

export default function BudgetsScreen() {
  const month = monthKey();
  const user = sessionStore((state) => state.user);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
  });
  const budgetsQuery = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => api.budgets(month),
  });

  const saveBudget = useMutation({
    mutationFn: api.upsertBudget,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["budgets"] });
      void queryClient.invalidateQueries({ queryKey: ["report"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const budgetMap = new Map((budgetsQuery.data ?? []).map((budget) => [budget.categoryId ?? "overall", budget]));
  const categories = (categoriesQuery.data ?? []).filter(
    (category) =>
      category.kind === "expense" &&
      !category.archived &&
      !category.isSystem &&
      !["other", "trashed"].includes(category.name.trim().toLowerCase()),
  );
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? null,
    [categories, selectedId],
  );
  const selectedBudgetAmount = selectedCategory ? budgetMap.get(selectedCategory.id)?.amount ?? 0 : 0;

  return (
    <ScreenContainer screenKey="budgets">
      <PageHeader title="Budgets" />
      <Card>
        <View style={styles.list}>
          {categories.map((category) => {
            const existing = budgetMap.get(category.id);
            return (
              <View key={category.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <View style={[styles.colorSwatch, { backgroundColor: category.color }]} />
                  <View style={styles.textWrap}>
                    <Text style={styles.name}>{category.name}</Text>
                    <Text style={styles.meta}>{formatMoney(existing?.amount ?? 0, user?.currency ?? "USD")}</Text>
                  </View>
                </View>
                <PillButton
                  label="Edit"
                  tone="ghost"
                  onPress={() => {
                    setSelectedId(category.id);
                    setDraftAmount(String(existing?.amount ?? ""));
                    setIsModalOpen(true);
                  }}
                />
              </View>
            );
          })}
        </View>
      </Card>

      <Modal transparent visible={isModalOpen} animationType="fade" onRequestClose={() => setIsModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit budget</Text>
            <Text style={styles.modalCategory}>{selectedCategory?.name ?? "Category"}</Text>
            <Text style={styles.modalMeta}>
              Current: {formatMoney(selectedBudgetAmount, user?.currency ?? "USD")}
            </Text>
            <TextInput
              keyboardType="decimal-pad"
              placeholder="0.00"
              value={draftAmount}
              onChangeText={setDraftAmount}
              style={styles.input}
            />
            <View style={styles.actions}>
              <PillButton label="Cancel" tone="ghost" onPress={() => setIsModalOpen(false)} />
              <PillButton
                label={saveBudget.isPending ? "Saving..." : "Save"}
                onPress={() => {
                  if (!selectedCategory || saveBudget.isPending) {
                    return;
                  }
                  saveBudget.mutate({
                    categoryId: selectedCategory.id,
                    month,
                    amount: Number(draftAmount || selectedBudgetAmount || 0),
                  });
                  setIsModalOpen(false);
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
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  textWrap: {
    gap: 2,
  },
  colorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 999,
  },
  name: {
    color: theme.colors.ink,
    fontWeight: "700",
    fontSize: 16,
  },
  meta: {
    color: theme.colors.muted,
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
  },
  modalTitle: {
    color: theme.colors.ink,
    fontSize: 22,
    fontWeight: "700",
  },
  modalCategory: {
    color: theme.colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  modalMeta: {
    color: theme.colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    color: theme.colors.ink,
    fontSize: 16,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
});
