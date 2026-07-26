import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildSimulatedDebtScore, type Debt } from "@spending-tracker/shared";
import { Modal, Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Card, FormModal, Metric, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { WebPressable as Pressable } from "../../src/components/web-pressable";
import { api } from "../../src/lib/api";
import { combineDateAndTime, formatDateTimeLabel, formatMoney, rollMonthlyDateForward, toDateInputValue, toTimeInputValue } from "../../src/lib/date";
import { checkDebtReminders } from "../../src/hooks/use-debt-reminders";
import { sessionStore } from "../../src/state/session";
import { theme } from "../../src/theme";

type ReminderDays = 0 | 1 | 3 | 7 | null;
const reminderOptions: Array<{ value: ReminderDays; label: string }> = [
  { value: null, label: "Off" },
  { value: 0, label: "Due time" },
  { value: 1, label: "1 day before" },
  { value: 3, label: "3 days before" },
  { value: 7, label: "1 week before" },
];

function defaultDueDate() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(9, 0, 0, 0);
  return value;
}

function normalizeAmountInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...decimal] = cleaned.split(".");
  return decimal.length ? `${whole}.${decimal.join("")}` : whole ?? "";
}

export default function DebtsScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const user = sessionStore((state) => state.user);
  const userId = user?.id ?? "anonymous";
  const currency = user?.currency ?? "USD";
  const queryClient = useQueryClient();
  const initialDue = useMemo(defaultDueDate, []);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Debt | null>(null);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(toDateInputValue(initialDue));
  const [dueTime, setDueTime] = useState(toTimeInputValue(initialDue));
  const [reminderDays, setReminderDays] = useState<ReminderDays>(null);
  const [formError, setFormError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const webAmountProps = Platform.OS === "web" ? ({ inputMode: "decimal" } as const) : {};
  const webDateProps = Platform.OS === "web" ? ({ type: "date" } as const) : {};
  const webTimeProps = Platform.OS === "web" ? ({ type: "time" } as const) : {};

  const debtsQuery = useQuery({ queryKey: ["debts", userId], queryFn: api.debts });
  const debts = debtsQuery.data ?? [];
  const openDebts = debts.filter((debt) => !debt.paidAt);
  const now = Date.now();
  const nextWeek = now + 7 * 24 * 60 * 60 * 1000;
  const outstandingTotal = openDebts.reduce((sum, debt) => sum + debt.amount, 0);
  const overdueTotal = openDebts
    .filter((debt) => new Date(debt.dueAt).getTime() < now)
    .reduce((sum, debt) => sum + debt.amount, 0);
  const dueSoonTotal = openDebts
    .filter((debt) => {
      const dueAt = new Date(debt.dueAt).getTime();
      return dueAt >= now && dueAt <= nextWeek;
    })
    .reduce((sum, debt) => sum + debt.amount, 0);
  const merchantHints = useMemo(() => {
    const query = merchant.trim().toLowerCase();
    if (!query) return [];

    const savedMerchants = [...debts]
      .sort((left, right) => new Date(right.dueAt).getTime() - new Date(left.dueAt).getTime())
      .reduce<Array<{ merchant: string; dueAt: string }>>((saved, debt) => {
        const name = debt.merchant.trim();
        if (name && !saved.some((item) => item.merchant.toLowerCase() === name.toLowerCase())) {
          saved.push({ merchant: name, dueAt: debt.dueAt });
        }
        return saved;
      }, []);

    return savedMerchants
      .filter((item) => item.merchant.toLowerCase().includes(query) && item.merchant.toLowerCase() !== query)
      .slice(0, 5);
  }, [debts, merchant]);
  const simulatedScore = useMemo(() => buildSimulatedDebtScore(debts), [debts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const numericAmount = Number(amount);
      if (!merchant.trim() || !numericAmount || !dueDate || !dueTime) {
        throw new Error("Complete the merchant, amount, and due date.");
      }
      const input = {
        merchant: merchant.trim(),
        amount: numericAmount,
        dueAt: combineDateAndTime(dueDate, dueTime),
        reminderDaysBefore: reminderDays,
      };
      return editingDebt ? api.updateDebt(editingDebt.id, input) : api.createDebt(input);
    },
    onMutate: () => setFormError(""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["debts"] });
      resetForm();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : "Could not save debt."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, paidAt }: { id: string; paidAt: string | null }) => api.updateDebt(id, { paidAt }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["debts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteDebt,
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });

  function resetForm() {
    const nextDue = defaultDueDate();
    setEditingDebt(null);
    setMerchant("");
    setAmount("");
    setDueDate(toDateInputValue(nextDue));
    setDueTime(toTimeInputValue(nextDue));
    setReminderDays(null);
    setFormError("");
    setIsFormOpen(false);
  }

  function openCreateForm() {
    resetForm();
    setIsFormOpen(true);
  }

  function editDebt(debt: Debt) {
    setEditingDebt(debt);
    setMerchant(debt.merchant);
    setAmount(String(debt.amount));
    setDueDate(toDateInputValue(debt.dueAt));
    setDueTime(toTimeInputValue(debt.dueAt));
    setReminderDays(debt.reminderDaysBefore);
    setFormError("");
    setIsFormOpen(true);
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      await checkDebtReminders(currency).catch(() => undefined);
    }
  }

  return (
    <ScreenContainer
      screenKey="debts"
      onRefresh={async () => debtsQuery.refetch().then(() => undefined)}
    >
      <PageHeader title="Debt watcher" subtitle="Keep upcoming bills in one place and get a reminder before they are due." />

      <View style={[styles.metrics, compact && styles.metricsCompact]}>
        <Card style={[styles.metricCard, compact && styles.metricCardCompact]}><Metric label="Open items" value={String(openDebts.length)} /></Card>
        <Card style={[styles.metricCard, compact && styles.metricCardCompact]}><Metric label="Total outstanding" value={formatMoney(outstandingTotal, currency)} /></Card>
        <Card style={[styles.metricCard, compact && styles.metricCardCompact]}><Metric label="Due in 7 days" value={formatMoney(dueSoonTotal, currency)} /></Card>
        <Card style={[styles.metricCard, compact && styles.metricCardCompact]}><Metric label="Overdue" value={formatMoney(overdueTotal, currency)} tone={overdueTotal ? "warning" : "default"} /></Card>
      </View>

      <Card>
        <View style={styles.scoreHeader}>
          <SectionTitle
            title="Simulated credit score"
            subtitle="Estimated only from activity recorded in Debt Watcher. This is an educational estimate, not a credit-bureau score, and lenders do not use it."
          />
          <View style={styles.scoreValueBlock}>
            <Text style={[styles.scoreValue, simulatedScore.score < 580 && styles.scoreValueWarning]}>{simulatedScore.score}</Text>
            <Text style={styles.scoreBand}>{simulatedScore.band} · {simulatedScore.confidence} confidence</Text>
          </View>
        </View>
        <View style={styles.scoreFactors}>
          {simulatedScore.factors.map((factor) => (
            <View key={factor.label} style={styles.scoreFactor}>
              <Text style={[
                styles.scoreFactorLabel,
                factor.tone === "positive" && styles.scoreFactorPositive,
                factor.tone === "negative" && styles.scoreFactorNegative,
              ]}>{factor.label}</Text>
              <Text style={styles.hint}>{factor.detail}</Text>
            </View>
          ))}
        </View>
      </Card>

      <FormModal
        visible={isFormOpen}
        title={editingDebt ? "Edit debt" : "Add a debt"}
        subtitle="Choose when the alarm should appear."
        onClose={resetForm}
        size="wide"
        footer={
          <PillButton
            label={saveMutation.isPending ? "Saving..." : editingDebt ? "Save changes" : "Add debt"}
            onPress={() => saveMutation.mutate()}
          />
        }
      >
        <View style={styles.formFields}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Amount</Text>
            <TextInput
              {...webAmountProps}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={(value) => setAmount(normalizeAmountInput(value))}
              placeholder="0.00"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Merchant</Text>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Merchant name"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
            />
            {merchantHints.length > 0 ? (
              <View style={styles.suggestionList}>
                {merchantHints.map((item) => (
                  <Pressable
                    key={item.merchant}
                    style={styles.suggestionChip}
                    onPress={() => {
                      const nextDue = rollMonthlyDateForward(item.dueAt);
                      setMerchant(item.merchant);
                      setDueDate(toDateInputValue(nextDue));
                      setDueTime(toTimeInputValue(nextDue));
                    }}
                  >
                    <Text style={styles.suggestionText}>{item.merchant}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Due date</Text>
            <TextInput {...webDateProps} value={dueDate} onChangeText={setDueDate} style={styles.input} />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Due time</Text>
            <TextInput {...webTimeProps} value={dueTime} onChangeText={setDueTime} style={styles.input} />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Alarm</Text>
            <View style={styles.choiceRow}>
              {reminderOptions.map((option) => (
                <Pressable
                  key={String(option.value)}
                  onPress={() => setReminderDays(option.value)}
                  style={[styles.choice, reminderDays === option.value && styles.choiceActive]}
                >
                  <Text style={[styles.choiceText, reminderDays === option.value && styles.choiceTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            {reminderDays !== null && notificationPermission !== "granted" ? (
              <View style={styles.permissionRow}>
                <Text style={styles.hint}>
                  {notificationPermission === "denied"
                    ? "Notifications are blocked in your browser settings."
                    : notificationPermission === "unsupported"
                    ? "This browser does not support notifications."
                    : "Allow notifications so alarms can appear."}
                </Text>
                {notificationPermission === "default" ? <PillButton label="Allow notifications" tone="ghost" onPress={() => void enableNotifications()} /> : null}
              </View>
            ) : null}
          </View>

          {formError ? <Text style={styles.error}>{formError}</Text> : null}
        </View>
      </FormModal>

      <Card>
        <View style={styles.sectionHeader}>
          <SectionTitle title="Your debts" subtitle="Open items appear first, ordered by due date." />
          <PillButton label="Add debt" onPress={openCreateForm} />
        </View>
        <View style={styles.list}>
          {!debts.length ? <Text style={styles.empty}>No debts added yet.</Text> : debts.map((debt, index) => {
            const overdue = !debt.paidAt && new Date(debt.dueAt).getTime() < Date.now();
            return (
              <View
                key={debt.id}
                style={[
                  styles.debtRow,
                  index === debts.length - 1 && styles.debtRowLast,
                  Boolean(debt.paidAt) && styles.debtRowPaid,
                ]}
              >
                <View style={styles.debtInfo}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.debtMerchant, Boolean(debt.paidAt) && styles.paidText]}>{debt.merchant}</Text>
                    {overdue ? <Text style={styles.overdueBadge}>Overdue</Text> : null}
                    {debt.paidAt ? <Text style={styles.paidBadge}>Paid</Text> : null}
                  </View>
                  <Text style={styles.debtAmount}>{formatMoney(debt.amount, currency)}</Text>
                  <Text style={styles.debtMeta}>
                    Due {formatDateTimeLabel(debt.dueAt)}
                    {debt.reminderDaysBefore === null ? " · Alarm off" : ` · Alarm ${reminderOptions.find((item) => item.value === debt.reminderDaysBefore)?.label.toLowerCase()}`}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <PillButton label={debt.paidAt ? "Reopen" : "Mark paid"} tone="ghost" onPress={() => updateMutation.mutate({ id: debt.id, paidAt: debt.paidAt ? null : new Date().toISOString() })} />
                  <PillButton label="Edit" tone="ghost" onPress={() => editDebt(debt)} />
                  <PillButton label="Delete" tone="ghost" onPress={() => setPendingDelete(debt)} />
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Modal transparent visible={Boolean(pendingDelete)} animationType="fade" onRequestClose={() => setPendingDelete(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete this debt?</Text>
            <Text style={styles.hint}>{pendingDelete?.merchant} will be permanently removed.</Text>
            <View style={styles.modalActions}>
              <PillButton label="Cancel" tone="ghost" onPress={() => setPendingDelete(null)} />
              <PillButton label={deleteMutation.isPending ? "Deleting..." : "Delete"} onPress={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  metricsCompact: { flexDirection: "column" },
  metricCard: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  metricCardCompact: { flexGrow: 0, flexBasis: "auto" },
  scoreHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  scoreValueBlock: { alignItems: "flex-end", gap: 2 },
  scoreValue: { color: theme.colors.accent, fontSize: 42, fontWeight: "900", lineHeight: 46 },
  scoreValueWarning: { color: theme.colors.warning },
  scoreBand: { color: theme.colors.muted, ...theme.typography.label, fontWeight: "700" },
  scoreDisclaimer: { color: theme.colors.muted, ...theme.typography.caption },
  scoreFactors: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  scoreFactor: { flexGrow: 1, flexBasis: 220, minWidth: 0, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10, gap: 4 },
  scoreFactorLabel: { color: theme.colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  scoreFactorPositive: { color: theme.colors.success },
  scoreFactorNegative: { color: theme.colors.warning },
  sectionHeader: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  formFields: { gap: 14, marginBottom: 15 },
  fieldGroup: { flexGrow: 0, flexShrink: 0, gap: 8, minWidth: 0 },
  label: { color: theme.colors.ink, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 14,
    paddingVertical: 12, backgroundColor: theme.colors.field, color: theme.colors.ink, fontSize: 16,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  suggestionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestionChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.colors.accentSoft },
  suggestionText: { color: theme.colors.accentSoftText, ...theme.typography.label, fontWeight: "700" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", flexShrink: 0, gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: theme.colors.accentSoft },
  choiceActive: { backgroundColor: theme.colors.accent },
  choiceText: { color: theme.colors.accentSoftText, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  choiceTextActive: { color: theme.colors.accentText },
  permissionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  hint: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  error: { color: theme.colors.warning, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  list: {},
  empty: { color: theme.colors.muted, ...theme.typography.body, paddingVertical: 18, textAlign: "center" },
  debtRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  debtRowLast: { borderBottomWidth: 0 },
  debtRowPaid: { opacity: 0.7 },
  debtInfo: { flex: 1, minWidth: 230, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  debtMerchant: { color: theme.colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "800" },
  paidText: { textDecorationLine: "line-through" },
  debtAmount: { color: theme.colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  debtMeta: { color: theme.colors.muted, ...theme.typography.label },
  overdueBadge: { color: theme.colors.warning, backgroundColor: theme.colors.field, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, ...theme.typography.caption, fontWeight: "800" },
  paidBadge: { color: theme.colors.success, backgroundColor: theme.colors.field, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, ...theme.typography.caption, fontWeight: "800" },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modalScrim: { flex: 1, backgroundColor: "rgba(27, 29, 31, 0.42)", justifyContent: "center", padding: 20 },
  modalCard: { alignSelf: "center", width: "100%", maxWidth: 440, backgroundColor: theme.colors.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 20, gap: 14, ...theme.shadow },
  modalTitle: { color: theme.colors.ink, fontSize: 22, lineHeight: 28, fontWeight: "800" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
});
