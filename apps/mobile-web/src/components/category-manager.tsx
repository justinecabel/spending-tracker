import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Category } from "@spending-tracker/shared";
import { PillButton } from "./ui";
import { theme } from "../theme";

const COLOR_OPTIONS = ["#16A34A", "#2563EB", "#D97706", "#DC2626", "#7C3AED", "#0891B2", "#F59E0B", "#4B5563"];

export function CategoryManager({
  categories,
  isSaving,
  error,
  onSave,
}: {
  categories: Category[];
  isSaving: boolean;
  error?: string | null;
  onSave: (input: { id: string; name: string; color: string }) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(COLOR_OPTIONS[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? null,
    [categories, selectedId],
  );

  useEffect(() => {
    if (!selectedCategory) {
      return;
    }
    setDraftName(selectedCategory.name);
    setDraftColor(selectedCategory.color);
  }, [selectedCategory]);

  return (
    <View style={styles.list}>
      {categories.map((category) => (
        <View key={category.id} style={styles.row}>
          <View style={styles.rowInfo}>
            <View style={[styles.colorSwatch, { backgroundColor: category.color }]} />
            <View style={styles.textWrap}>
              <Text style={styles.name}>{category.name}</Text>
              <Text style={styles.meta}>{category.kind}</Text>
            </View>
          </View>
          <PillButton
            label="Edit"
            tone="ghost"
            onPress={() => {
              setSelectedId(category.id);
              setDraftName(category.name);
              setDraftColor(category.color);
              setIsModalOpen(true);
            }}
          />
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal transparent visible={isModalOpen} animationType="fade" onRequestClose={() => setIsModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit category</Text>
            <TextInput value={draftName} onChangeText={setDraftName} placeholder="Category name" style={styles.input} />
            <View style={styles.colors}>
              {COLOR_OPTIONS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setDraftColor(color)}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    draftColor === color && styles.colorOptionActive,
                  ]}
                />
              ))}
            </View>
            <View style={styles.actions}>
              <PillButton label="Cancel" tone="ghost" onPress={() => setIsModalOpen(false)} />
              <PillButton
                label={isSaving ? "Saving..." : "Save"}
                onPress={() => {
                  if (!selectedCategory || !draftName.trim() || isSaving) {
                    return;
                  }
                  onSave({
                    id: selectedCategory.id,
                    name: draftName.trim(),
                    color: draftColor,
                  });
                  setIsModalOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
    marginTop: 16,
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
    textTransform: "capitalize",
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
  colors: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorOption: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorOptionActive: {
    borderColor: theme.colors.ink,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  error: {
    color: theme.colors.warning,
  },
});
