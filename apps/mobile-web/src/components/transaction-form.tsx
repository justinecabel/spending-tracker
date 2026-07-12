import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { Category, CreateTransactionInput } from "@spending-tracker/shared";
import { combineDateAndTime, toDateInputValue, toTimeInputValue } from "../lib/date";
import { theme } from "../theme";

function normalizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) {
    return cleaned;
  }
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function isSelectableCategory(category: Category) {
  const normalizedName = category.name.trim().toLowerCase();
  return (
    category.kind === "expense" &&
    !category.archived &&
    !category.isSystem &&
    normalizedName !== "other" &&
    normalizedName !== "trashed"
  );
}

export function TransactionForm({
  categories,
  merchantSuggestions,
  onSubmit,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: {
  categories: Category[];
  merchantSuggestions: string[];
  onSubmit: (value: CreateTransactionInput) => void | Promise<void>;
  onCreateCategory: (value: { name: string; color: string }) => Promise<Category>;
  onUpdateCategory: (id: string, value: { name: string; color: string }) => Promise<Category>;
  onDeleteCategory: (id: string) => Promise<Category>;
}) {
  const { width } = useWindowDimensions();
  const compactDateTime = width < 420;
  const expenseCategories = useMemo(
    () => categories.filter(isSelectableCategory),
    [categories],
  );
  const [localCategories, setLocalCategories] = useState<Category[]>([]);
  const allExpenseCategories = useMemo(() => {
    const merged = [...localCategories, ...expenseCategories];
    return merged.filter((category, index) => {
      const firstIndex = merged.findIndex((candidate) => candidate.id === category.id);
      return firstIndex === index && isSelectableCategory(category);
    });
  }, [expenseCategories, localCategories]);
  function upsertLocalCategory(nextCategory: Category) {
    setLocalCategories((current) => {
      const existingIndex = current.findIndex((category) => category.id === nextCategory.id);
      if (existingIndex === -1) {
        return [nextCategory, ...current];
      }

      const copy = [...current];
      copy[existingIndex] = nextCategory;
      return copy;
    });
  }

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [merchant, setMerchant] = useState("");
  const [dateValue, setDateValue] = useState(() => toDateInputValue(new Date()));
  const [timeValue, setTimeValue] = useState(() => toTimeInputValue(new Date()));
  const [categoryId, setCategoryId] = useState<string>(expenseCategories[0]?.id ?? categories[0]?.id ?? "");
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#0F766E");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryColor, setEditingCategoryColor] = useState("#0F766E");
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);
  const merchantMatches = useMemo(() => {
    const query = merchant.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return merchantSuggestions
      .filter((value) => value.trim().length > 0)
      .filter((value) => value.toLowerCase().includes(query) && value.toLowerCase() !== query)
      .slice(0, 5);
  }, [merchant, merchantSuggestions]);
  const webAmountInputProps = Platform.OS === "web" ? ({ inputMode: "decimal" } as const) : {};
  const webDateInputProps = Platform.OS === "web" ? ({ type: "date" } as const) : {};
  const webTimeInputProps = Platform.OS === "web" ? ({ type: "time" } as const) : {};
  useEffect(() => {
    if (!allExpenseCategories.some((category) => category.id === categoryId)) {
      setCategoryId(allExpenseCategories[0]?.id ?? "");
    }
  }, [allExpenseCategories, categoryId]);

  function submitTransaction() {
    const numericAmount = Number(amount);
    if (!numericAmount || !categoryId) {
      return;
    }
    void onSubmit({
      amount: numericAmount,
      categoryId,
      kind: "expense",
      occurredAt: combineDateAndTime(dateValue, timeValue),
      note: note || null,
      merchant: merchant || null,
      clientId: `client-${Date.now()}`,
    });
    setAmount("");
    setMerchant("");
    setNote("");
    const now = new Date();
    setDateValue(toDateInputValue(now));
    setTimeValue(toTimeInputValue(now));
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} showsVerticalScrollIndicator>
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
          {merchantMatches.length > 0 ? (
            <View style={styles.suggestionList}>
              {merchantMatches.map((value) => (
                <Pressable key={value} style={styles.suggestionChip} onPress={() => setMerchant(value)}>
                  <Text style={styles.suggestionText}>{value}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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
            {allExpenseCategories.map((category) => (
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
            <Pressable style={[styles.categoryChip, styles.addCategoryChip]} onPress={() => setIsCategoryModalOpen(true)}>
              <Text style={styles.addCategoryText}>+ Add category</Text>
            </Pressable>
            <Pressable
              style={[styles.categoryChip, styles.manageCategoryChip]}
              onPress={() => {
                const selected = allExpenseCategories.find((category) => category.id === categoryId) ?? allExpenseCategories[0];
                if (!selected) {
                  return;
                }
                setEditingCategoryId(selected.id);
                setEditingCategoryName(selected.name);
                setEditingCategoryColor(selected.color);
                setCategoryError(null);
                setIsManageModalOpen(true);
              }}
            >
              <Text style={styles.addCategoryText}>Edit category</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <View style={styles.submitWrap}>
        <Pressable
          style={styles.submit}
          onPress={submitTransaction}
        >
          <Text style={styles.submitText}>Save transaction</Text>
        </Pressable>
      </View>

      <Modal transparent visible={isCategoryModalOpen} animationType="fade" onRequestClose={() => setIsCategoryModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New category</Text>
            <TextInput
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Category name"
              style={styles.input}
              placeholderTextColor={theme.colors.muted}
            />
            <View style={styles.colorRow}>
              {["#0F766E", "#F97316", "#2563EB", "#DC2626", "#7C3AED"].map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setNewCategoryColor(color)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    newCategoryColor === color && styles.colorSwatchActive,
                  ]}
                />
              ))}
            </View>
            {categoryError ? <Text style={styles.errorText}>{categoryError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable style={[styles.secondaryButton]} onPress={() => setIsCategoryModalOpen(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.submit, styles.modalSubmit, isCreatingCategory && styles.buttonDisabled]}
                onPress={async () => {
                  const trimmedName = newCategoryName.trim();
                  if (!trimmedName) {
                    setCategoryError("Category name is required.");
                    return;
                  }

                  try {
                    setCategoryError(null);
                    setIsCreatingCategory(true);
                    const category = await onCreateCategory({ name: trimmedName, color: newCategoryColor });
                    upsertLocalCategory(category);
                    setCategoryId(category.id);
                    setNewCategoryName("");
                    setNewCategoryColor("#0F766E");
                    setIsCategoryModalOpen(false);
                  } catch (error) {
                    setCategoryError(error instanceof Error ? error.message : "Could not create category.");
                  } finally {
                    setIsCreatingCategory(false);
                  }
                }}
              >
                <Text style={styles.submitText}>{isCreatingCategory ? "Saving..." : "Save category"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={isManageModalOpen} animationType="fade" onRequestClose={() => setIsManageModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit category</Text>
            <View style={styles.categoryRow}>
              {allExpenseCategories.map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => {
                    setEditingCategoryId(category.id);
                    setEditingCategoryName(category.name);
                    setEditingCategoryColor(category.color);
                    setCategoryError(null);
                  }}
                  style={[
                    styles.categoryChip,
                    {
                      borderColor: category.color,
                      backgroundColor: editingCategoryId === category.id ? category.color : "#FFFFFF",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      { color: editingCategoryId === category.id ? "#FFFFFF" : category.color },
                    ]}
                  >
                    {category.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={editingCategoryName}
              onChangeText={setEditingCategoryName}
              placeholder="Category name"
              style={styles.input}
              placeholderTextColor={theme.colors.muted}
            />
            <View style={styles.colorRow}>
              {["#0F766E", "#F97316", "#2563EB", "#DC2626", "#7C3AED", "#16A34A", "#0891B2"].map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setEditingCategoryColor(color)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    editingCategoryColor === color && styles.colorSwatchActive,
                  ]}
                />
              ))}
            </View>
            {categoryError ? <Text style={styles.errorText}>{categoryError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.deleteButton, isDeletingCategory && styles.buttonDisabled]}
                onPress={async () => {
                  if (!editingCategoryId) {
                    return;
                  }

                  try {
                    setCategoryError(null);
                    setIsDeletingCategory(true);
                    const deleted = await onDeleteCategory(editingCategoryId);
                    upsertLocalCategory(deleted);
                    const nextCategory = allExpenseCategories.find((category) => category.id !== editingCategoryId);
                    setCategoryId(nextCategory?.id ?? "");
                    setIsManageModalOpen(false);
                  } catch (error) {
                    setCategoryError(error instanceof Error ? error.message : "Could not delete category.");
                  } finally {
                    setIsDeletingCategory(false);
                  }
                }}
              >
                <Text style={styles.deleteButtonText}>{isDeletingCategory ? "Deleting..." : "Delete"}</Text>
              </Pressable>
              <Pressable style={[styles.secondaryButton]} onPress={() => setIsManageModalOpen(false)}>
                <Text style={styles.secondaryButtonText}>Close</Text>
              </Pressable>
              <Pressable
                style={[styles.submit, styles.modalSubmit, (isUpdatingCategory || isDeletingCategory) && styles.buttonDisabled]}
                onPress={async () => {
                  const trimmedName = editingCategoryName.trim();
                  if (!editingCategoryId || !trimmedName) {
                    setCategoryError("Category name is required.");
                    return;
                  }

                  try {
                    setCategoryError(null);
                    setIsUpdatingCategory(true);
                    const updated = await onUpdateCategory(editingCategoryId, {
                      name: trimmedName,
                      color: editingCategoryColor,
                    });
                    upsertLocalCategory(updated);
                    setCategoryId(updated.id);
                    setIsManageModalOpen(false);
                  } catch (error) {
                    setCategoryError(error instanceof Error ? error.message : "Could not update category.");
                  } finally {
                    setIsUpdatingCategory(false);
                  }
                }}
              >
                <Text style={styles.submitText}>{isUpdatingCategory ? "Saving..." : "Save changes"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    gap: 12,
    paddingBottom: 8,
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
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  categoryText: {
    fontWeight: "600",
  },
  addCategoryChip: {
    borderStyle: "dashed",
    backgroundColor: theme.colors.field,
  },
  manageCategoryChip: {
    backgroundColor: theme.colors.field,
  },
  addCategoryText: {
    color: theme.colors.accent,
    fontWeight: "700",
  },
  submit: {
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitWrap: {
    paddingTop: 4,
  },
  submitText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  suggestionList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.accentSoft,
  },
  suggestionText: {
    color: theme.colors.accent,
    fontWeight: "600",
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
  colorRow: {
    flexDirection: "row",
    gap: 10,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSwatchActive: {
    borderColor: theme.colors.ink,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  secondaryButton: {
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: theme.colors.accent,
    fontWeight: "700",
  },
  modalSubmit: {
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  deleteButton: {
    borderRadius: 999,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deleteButtonText: {
    color: "#B91C1C",
    fontWeight: "700",
  },
  errorText: {
    color: theme.colors.warning,
    fontSize: 13,
  },
});
