import { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { Category, CreateTransactionInput } from "@spending-tracker/shared";
import { combineDateAndTime, toDateInputValue, toTimeInputValue } from "../lib/date";
import { theme } from "../theme";
import { WebPressable as Pressable } from "./web-pressable";
import { FormModal } from "./ui";

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
  merchantSuggestions: Array<{ merchant: string; categoryId: string | null }>;
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
      .filter((item) => item.merchant.trim().length > 0)
      .filter((item) => item.merchant.toLowerCase().includes(query) && item.merchant.toLowerCase() !== query)
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
              {merchantMatches.map((item) => (
                <Pressable
                  key={item.merchant}
                  style={styles.suggestionChip}
                  onPress={() => {
                    setMerchant(item.merchant);
                    if (item.categoryId && allExpenseCategories.some((category) => category.id === item.categoryId)) {
                      setCategoryId(item.categoryId);
                    }
                  }}
                >
                  <Text style={styles.suggestionText}>{item.merchant}</Text>
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

      <FormModal visible={isCategoryModalOpen} title="New category" onClose={() => setIsCategoryModalOpen(false)}>
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
            <View style={styles.customColorField}>
              <Text style={styles.colorInputLabel}>Custom Color hex</Text>
              <View style={styles.customColorRow}>
                <TextInput
                  value={newCategoryColor}
                  onChangeText={(value) => setNewCategoryColor(normalizeHexColor(value))}
                  placeholder="#0F766E"
                  style={[styles.input, styles.colorHexInput]}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  maxLength={7}
                />
                <View
                  accessibilityLabel="Custom category color preview"
                  style={[styles.customColorPreview, { backgroundColor: isHexColor(newCategoryColor) ? newCategoryColor : theme.colors.field }]}
                />
              </View>
            </View>
            {categoryError ? <Text style={styles.errorText}>{categoryError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.submit, styles.modalSubmit, isCreatingCategory && styles.buttonDisabled]}
                onPress={async () => {
                  const trimmedName = newCategoryName.trim();
                  if (!trimmedName) {
                    setCategoryError("Category name is required.");
                    return;
                  }
                  if (!isHexColor(newCategoryColor)) {
                    setCategoryError("Use a six-digit color such as #0F766E.");
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
      </FormModal>

      <FormModal visible={isManageModalOpen} title="Edit category" onClose={() => setIsManageModalOpen(false)} size="wide">
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
            <View style={styles.customColorField}>
              <Text style={styles.colorInputLabel}>Custom Color hex</Text>
              <View style={styles.customColorRow}>
                <TextInput
                  value={editingCategoryColor}
                  onChangeText={(value) => setEditingCategoryColor(normalizeHexColor(value))}
                  placeholder="#0F766E"
                  style={[styles.input, styles.colorHexInput]}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  maxLength={7}
                />
                <View
                  accessibilityLabel="Custom category color preview"
                  style={[styles.customColorPreview, { backgroundColor: isHexColor(editingCategoryColor) ? editingCategoryColor : theme.colors.field }]}
                />
              </View>
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
              <Pressable
                style={[styles.submit, styles.modalSubmit, (isUpdatingCategory || isDeletingCategory) && styles.buttonDisabled]}
                onPress={async () => {
                  const trimmedName = editingCategoryName.trim();
                  if (!editingCategoryId || !trimmedName) {
                    setCategoryError("Category name is required.");
                    return;
                  }
                  if (!isHexColor(editingCategoryColor)) {
                    setCategoryError("Use a six-digit color such as #0F766E.");
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
      </FormModal>
    </View>
  );
}

function normalizeHexColor(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

function isHexColor(value: string) {
  return /^#[0-9A-F]{6}$/.test(value);
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
    ...theme.typography.label,
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
    fontSize: 14,
    lineHeight: 20,
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
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  submit: {
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
    marginTop: 4,
  },
  submitText: {
    color: theme.colors.accentText,
    ...theme.typography.control,
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
    color: theme.colors.accentSoftText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  colorRow: {
    flexDirection: "row",
    gap: 10,
  },
  customColorField: {
    gap: 6,
  },
  customColorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  colorInputLabel: {
    color: theme.colors.muted,
    ...theme.typography.label,
    fontWeight: "600",
  },
  colorHexInput: {
    flex: 1,
    paddingVertical: 10,
  },
  customColorPreview: {
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    height: 42,
    width: 42,
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
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
    marginTop: 4,
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
    ...theme.typography.control,
    fontWeight: "700",
  },
  errorText: {
    color: theme.colors.warning,
    ...theme.typography.label,
  },
});
