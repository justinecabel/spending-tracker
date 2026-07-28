import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Card, FormModal, HelpTooltip, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { ScreenContainer } from "../../src/components/layout";
import { TransferOutPanel } from "../../src/components/transfer-session";
import { api } from "../../src/lib/api";
import { collectClientDiagnostics, runNotificationDiagnostic } from "../../src/lib/client-diagnostics";
import { nanoid } from "nanoid/non-secure";
import { appearanceStore, getAppearanceProfileKey } from "../../src/state/appearance";
import { summaryRangeStore, type SummaryRangeMode } from "../../src/state/summary-range";
import { sessionStore } from "../../src/state/session";
import { offlineQueueStore } from "../../src/state/offline-queue";
import { applyThemeMode, normalizeCustomAccent, theme } from "../../src/theme";
import { WebPressable as Pressable } from "../../src/components/web-pressable";

const rangeModes: Array<{ key: SummaryRangeMode; label: string }> = [
  { key: "this-month", label: "This month" },
  { key: "all-time", label: "All time" },
  { key: "last-30-days", label: "Last 30 days" },
  { key: "last-15-days", label: "Last 15 days" },
  { key: "custom-date", label: "Custom date" },
  { key: "smart-pay-cycle", label: "Smart pay cycle" },
];

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const deviceScheme = useColorScheme();
  const user = sessionStore((state) => state.user);
  const activeProfile = sessionStore((state) => state.activeProfile);
  const appearanceProfileKey = getAppearanceProfileKey(activeProfile, user?.id);
  const appearanceMode = appearanceStore((state) => state.getMode(appearanceProfileKey));
  const setAppearanceMode = appearanceStore((state) => state.setMode);
  const customAccent = appearanceStore((state) => state.getAccent(appearanceProfileKey));
  const setAppearanceAccent = appearanceStore((state) => state.setAccent);
  const customSecondaryAccent = appearanceStore((state) => state.getSecondaryAccent(appearanceProfileKey));
  const setAppearanceSecondaryAccent = appearanceStore((state) => state.setSecondaryAccent);
  const deviceProfile = sessionStore((state) => state.deviceProfile);
  const linkedProfiles = sessionStore((state) => state.linkedProfiles);
  const activeLinkedProfileUserId = sessionStore((state) => state.activeLinkedProfileUserId);
  const setUser = sessionStore((state) => state.setUser);
  const updateDeviceProfileUser = sessionStore((state) => state.updateDeviceProfileUser);
  const activateProfile = sessionStore((state) => state.activateProfile);
  const removeLinkedProfile = sessionStore((state) => state.removeLinkedProfile);
  const clearSession = sessionStore((state) => state.clearSession);
  const enqueue = offlineQueueStore((state) => state.enqueue);
  const summaryMode = summaryRangeStore((state) => state.mode);
  const customFrom = summaryRangeStore((state) => state.customFrom);
  const customTo = summaryRangeStore((state) => state.customTo);
  const smartPaydays = summaryRangeStore((state) => state.smartPaydays);
  const setSummaryMode = summaryRangeStore((state) => state.setMode);
  const setCustomRange = summaryRangeStore((state) => state.setCustomRange);
  const setSmartPaydays = summaryRangeStore((state) => state.setSmartPaydays);
  const [currencyDraft, setCurrencyDraft] = useState(user?.currency ?? "USD");
  const [accentDraft, setAccentDraft] = useState(customAccent ?? "");
  const [secondaryAccentDraft, setSecondaryAccentDraft] = useState(customSecondaryAccent ?? "");
  const [accentError, setAccentError] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isOwnItModalOpen, setIsOwnItModalOpen] = useState(false);
  const [isDeveloperModalOpen, setIsDeveloperModalOpen] = useState(false);
  const [bugReportText, setBugReportText] = useState("");
  const [pendingForgetProfileId, setPendingForgetProfileId] = useState<string | null>(null);

  useEffect(() => {
    setCurrencyDraft(user?.currency ?? "USD");
  }, [user?.currency]);

  useEffect(() => {
    setAccentDraft(customAccent ?? "");
    setSecondaryAccentDraft(customSecondaryAccent ?? "");
    setAccentError(null);
  }, [appearanceProfileKey, customAccent, customSecondaryAccent]);

  // Give the Appearance editor a real-time preview. Saving is still required
  // to persist the colors for this profile; leaving the screen restores them.
  useEffect(() => {
    applyThemeMode(
      appearanceMode,
      deviceScheme,
      normalizeCustomAccent(accentDraft) ?? customAccent,
      normalizeCustomAccent(secondaryAccentDraft) ?? customSecondaryAccent,
    );
  }, [accentDraft, appearanceMode, customAccent, customSecondaryAccent, deviceScheme, secondaryAccentDraft]);

  useEffect(() => {
    return () => applyThemeMode(appearanceMode, deviceScheme, customAccent, customSecondaryAccent);
  }, [appearanceMode, customAccent, customSecondaryAccent, deviceScheme]);

  useEffect(() => {
    setIsImportModalOpen(false);
    setIsOwnItModalOpen(false);
    setPendingForgetProfileId(null);
    updatePreferences.reset();
    importDeviceDataMutation.reset();
    ownDeviceDataMutation.reset();
    diagnosticMutation.reset();
    bugReportMutation.reset();
  }, [activeProfile, user?.id]);

  const updatePreferences = useMutation({
    mutationFn: api.updateMe,
    onSuccess: ({ user: nextUser }) => {
      setUser(nextUser);
    },
  });
  const importDeviceDataMutation = useMutation({
    mutationFn: api.importDeviceData,
    onSuccess: () => {
      setIsImportModalOpen(false);
    },
  });
  const ownDeviceDataMutation = useMutation({
    mutationFn: api.ownDeviceData,
    onSuccess: ({ deviceUser }) => {
      updateDeviceProfileUser(deviceUser);
      setIsOwnItModalOpen(false);
    },
  });
  const diagnosticMutation = useMutation({
    mutationFn: async () => {
      const notificationTest = await runNotificationDiagnostic();
      const client = await collectClientDiagnostics();
      const report = await api.submitClientDiagnostic({ kind: "notification-diagnostic", client, notificationTest });
      return { report, notificationTest };
    },
  });
  const bugReportMutation = useMutation({
    mutationFn: async () => {
      const userText = bugReportText.trim();
      if (!userText) throw new Error("Describe the bug before sending.");
      const client = await collectClientDiagnostics();
      return api.submitClientDiagnostic({
        kind: "bug-report",
        client,
        notificationTest: null,
        userText,
      });
    },
  });

  function isOfflineOrNetworkError(error?: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("network") || message.includes("fetch");
  }

  function queuePreferenceUpdate(data: Parameters<typeof api.updateMe>[0]) {
    if (user) {
      setUser({ ...user, ...data });
    }
    enqueue({
      id: nanoid(),
      userId: user?.id ?? "anonymous",
      entity: "preferences",
      action: "update",
      payload: data,
      createdAt: new Date().toISOString(),
    });
  }

  async function handlePreferenceUpdate(data: Parameters<typeof api.updateMe>[0]) {
    if (isOfflineOrNetworkError()) {
      queuePreferenceUpdate(data);
      return;
    }
    try {
      await updatePreferences.mutateAsync(data);
    } catch (error) {
      if (isOfflineOrNetworkError(error)) {
        queuePreferenceUpdate(data);
      }
    }
  }

  const loginMode = activeProfile === "linked" ? "Sync Code" : "Device-ID";
  const hasLinkedProfiles = linkedProfiles.length > 0;
  const canImportLocalData = activeProfile === "linked" && Boolean(deviceProfile?.user) && hasLinkedProfiles;
  const canOwnDeviceData = activeProfile === "linked" && Boolean(deviceProfile?.user);
  const canForgetLinkedProfile = activeProfile === "linked" && Boolean(activeLinkedProfileUserId);
  const hasMultipleProfiles = Boolean(deviceProfile) && hasLinkedProfiles;
  const modalCardWidth = Math.min(Math.max(width - 40, 280), 560);

  return (
    <ScreenContainer screenKey="settings">
      <PageHeader title="Settings" />
      <Card style={styles.compactSettingsCard}>
        <View style={styles.profileFacts}>
          <View style={styles.profileFact}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{user?.name ?? "Unknown"}</Text>
          </View>
          <View style={styles.profileFact}>
            <Text style={styles.label}>Login mode</Text>
            <Text style={styles.value}>{loginMode}</Text>
          </View>
        </View>
        <View style={styles.list}>
          {hasMultipleProfiles ? (
            <View style={styles.switchBlock}>
              <Text style={styles.label}>Profiles</Text>
              <View style={styles.switchList}>
                {deviceProfile ? (
                  <PillButton
                    label="Device-ID"
                    tone={activeProfile === "device" ? "primary" : "ghost"}
                    onPress={() => activateProfile("device")}
                  />
                ) : null}
                {linkedProfiles.map((profile, index) => (
                  <View key={profile.user.id} style={styles.linkedProfileRow}>
                    <PillButton
                      label={`Sync ${index + 1}`}
                      tone={activeProfile === "linked" && activeLinkedProfileUserId === profile.user.id ? "primary" : "ghost"}
                      onPress={() => activateProfile("linked", profile.user.id)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <View>
            <Text style={styles.label}>Currency</Text>
            <View style={styles.currencyRow}>
              <TextInput
                value={currencyDraft}
                onChangeText={(value) => setCurrencyDraft(value.toUpperCase().slice(0, 3))}
                autoCapitalize="characters"
                maxLength={3}
                style={styles.currencyInput}
              />
              <PillButton
                label={updatePreferences.isPending ? "Saving..." : "Save"}
                tone="ghost"
                onPress={() => {
                  if (currencyDraft.trim().length !== 3 || updatePreferences.isPending) {
                    return;
                  }
                  void handlePreferenceUpdate({ currency: currencyDraft });
                }}
              />
            </View>
            {updatePreferences.error ? <Text style={styles.error}>{updatePreferences.error.message}</Text> : null}
          </View>
          <Pressable
            style={styles.signOutButton}
            onPress={() => {
              clearSession();
            }}
          >
            <Text style={styles.signOutButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </Card>
      <Card>
        <SectionTitle
          title="Summary range"
          subtitle="Choose the date window used by Home and Reports."
        />
        <View style={styles.rangeModeRow}>
          {rangeModes.map((option) => (
            <PillButton
              key={option.key}
              label={option.label}
              tone={summaryMode === option.key ? "primary" : "ghost"}
              onPress={() => setSummaryMode(option.key)}
            />
          ))}
        </View>
        {summaryMode === "custom-date" ? (
          <View style={styles.rangeEditor}>
            <View style={styles.rangeField}>
              <Text style={styles.label}>From</Text>
              <TextInput
                value={customFrom}
                onChangeText={(value) => setCustomRange(value, customTo)}
                placeholder="YYYY-MM-DD"
                style={styles.rangeInput}
              />
            </View>
            <View style={styles.rangeField}>
              <Text style={styles.label}>To</Text>
              <TextInput
                value={customTo}
                onChangeText={(value) => setCustomRange(customFrom, value)}
                placeholder="YYYY-MM-DD"
                style={styles.rangeInput}
              />
            </View>
          </View>
        ) : null}
        {summaryMode === "smart-pay-cycle" ? (
          <View style={styles.rangeEditor}>
            <View style={styles.labelWithHelp}>
              <Text style={styles.label}>Paydays</Text>
              <HelpTooltip
                label="About payday format"
                text="Use comma-separated days of the month, such as 15,30 or 5,20,30."
              />
            </View>
            <TextInput
              value={smartPaydays}
              onChangeText={setSmartPaydays}
              placeholder="15,30"
              style={styles.rangeInput}
            />
          </View>
        ) : null}
      </Card>

      <Card style={styles.compactSettingsCard}>
        <SectionTitle
          title="Appearance"
          subtitle="Choose the scheme plus optional primary and secondary colors for this profile."
        />
        <View style={styles.rangeModeRow}>
          <PillButton
            label="Device"
            tone={appearanceMode === "device" ? "primary" : "ghost"}
            onPress={() => setAppearanceMode(appearanceProfileKey, "device")}
          />
          <PillButton
            label="Light"
            tone={appearanceMode === "light" ? "primary" : "ghost"}
            onPress={() => setAppearanceMode(appearanceProfileKey, "light")}
          />
          <PillButton
            label="Dark"
            tone={appearanceMode === "dark" ? "primary" : "ghost"}
            onPress={() => setAppearanceMode(appearanceProfileKey, "dark")}
          />
        </View>
        <View style={styles.accentEditor}>
          <View style={styles.accentHeaderRow}>
            <View style={styles.labelWithHelp}>
              <Text style={styles.label}>Custom colors</Text>
              <HelpTooltip
                label="About custom colors"
                text="Primary changes buttons and highlights. Secondary changes soft selected and supporting surfaces."
              />
            </View>
            <PillButton
              label="Save colors"
              tone="ghost"
              onPress={() => {
                const nextAccent = normalizeCuÛ^ö¶‰žËkºwµç@€€€€€€€€€€€±…‰•°ô‰‰½ÕÐ¹½Ñ¥™¥…Ñ¥½¸‘¥…¹½ÍÑ¥Ìˆ4(€€€€€€€€€€€€€€€Ñ•áÐô‰Q•ÍÑÌ¹½Ñ¥™¥…Ñ¥½¸‘•±¥Ù•Éä…¹É•Á½ÉÑÌA]µ½‘”°‰É½ÝÍ•È…¹=L¡¥¹ÑÌ°ÍÉ••¸°Í•ÉÙ¥”µÝ½É­•ÈÍÑ…Ñ”°ÍÑ½É…”°½¹¹•Ñ¥½¸°±½…±”°…¹‘•Ù¥”…Á…‰¥±¥Ñ¥•Ì¸%Ð‘½•Ì¹½ÐÉ•…Á…ÍÍÝ½É‘Ì°™¥±•Ì°µ•ÍÍ…•Ì°½¹Ñ…ÑÌ°½ÈÁÉ•¥Í”±½…Ñ¥½¸¸Q¡”Í•ÉÙ•ÈÉ•½É‘ÌÑ¡”¹•ÑÝ½É¬…‘‘É•ÍÌ…¹ÍÑ…¹‘…ÉÉ•ÅÕ•ÍÐ¡•…‘•ÉÌ¥Ð¹½Éµ…±±äÉ••¥Ù•Ì¸ˆ4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€ñA¥±±	ÕÑÑ½¸4(€€€€€€€€€€€€€±…‰•°õí‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ€ü€‰Q•ÍÑ¥¹œ…¹Í•¹‘¥¹œ¸¸¸ˆ€è€‰IÕ¸¹½Ñ¥™¥…Ñ¥½¸Ñ•ÍÐ‰ô4(€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€¥˜€ …‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ¤‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ” ¤ì4(€€€€€€€€€€€€€õô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€€í‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹‘…Ñ„€ü€ 4(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥I•ÍÕ±Ñôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥MÕ•ÍÍôù¥…¹½ÍÑ¥ŒÉ•Á½ÉÐÍ•¹Ðð½Q•áÐø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Ù…±Õ•ôùI•Á½ÉÐ%èí‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹‘…Ñ„¹É•Á½ÉÐ¹É•Á½ÉÑ%‘ôð½Q•áÐø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹¡•±Á•ÉQ•áÑôø4(€€€€€€€€€€€€€€€€€9½Ñ¥™¥…Ñ¥½¸É•ÍÕ±Ðèí‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹‘…Ñ„¹¹½Ñ¥™¥…Ñ¥½¹Q•ÍÐ¹•ÉÉ½È4(€€€€€€€€€€€€€€€€€€€€üüÍ•¹ÐÕÍ¥¹œ€‘í‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹‘…Ñ„¹¹½Ñ¥™¥…Ñ¥½¹Q•ÍÐ¹‘•±¥Ù•Éå5•Ñ¡½‘ô¹ô4(€€€€€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(€€€€€€€€€€€í‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹•ÉÉ½È€ü€ 4(€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•ÉÉ½Éôùí‘¥…¹½ÍÑ¥5ÕÑ…Ñ¥½¸¹•ÉÉ½È¹µ•ÍÍ…•ôð½Q•áÐø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥%Ñ•µôø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹±…‰•±]¥Ñ¡!•±Áôø4(€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥%Ñ•µQ¥Ñ±•ôùI•Á½ÉÐ„‰Õœð½Q•áÐø4(€€€€€€€€€€€€€€ñ!•±ÁQ½½±Ñ¥À4(€€€€€€€€€€€€€€€±…‰•°ô‰‰½ÕÐ‰ÕœÉ•Á½ÉÑÌˆ4(€€€€€€€€€€€€€€€Ñ•áÐô‰•ÍÉ¥‰”Ý¡…Ð¡…ÁÁ•¹•¸Q¡”É•Á½ÉÐ…ÑÑ…¡•ÌA]°‰É½ÝÍ•È°=L°ÍÉ••¸°Í•ÉÙ¥”µÝ½É­•È°ÍÑ½É…”°½¹¹•Ñ¥½¸°±½…±”°…¹‘•Ù¥”…Á…‰¥±¥Ñä‘•Ñ…¥±Ì¸ˆ4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€ñQ•áÑ%¹ÁÕÐ4(€€€€€€€€€€€€€Ù…±Õ”õí‰ÕI•Á½ÉÑQ•áÑô4(€€€€€€€€€€€€€½¹¡…¹•Q•áÐõì¡Ù…±Õ”¤€ôøì4(€€€€€€€€€€€€€€€Í•Ñ	ÕI•Á½ÉÑQ•áÐ¡Ù…±Õ”¹Í±¥” À°€Ñ|ÀÀÀ¤¤ì4(€€€€€€€€€€€€€€€¥˜€¡‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹•ÉÉ½È¤‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹É•Í•Ð ¤ì4(€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰]¡…Ð¡…ÁÁ•¹•°…¹Ý¡…Ð‘¥å½Ô•áÁ•Ðüˆ4(€€€€€€€€€€€€€Á±…•¡½±‘•ÉQ•áÑ½±½ÈõíÑ¡•µ”¹½±½ÉÌ¹µÕÑ•‘ô4(€€€€€€€€€€€€€µÕ±Ñ¥±¥¹”4(€€€€€€€€€€€€€¹Õµ‰•É=™1¥¹•ÌõìÕô4(€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹‰ÕI•Á½ÉÑ%¹ÁÕÑô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹¡•±Á•ÉQ•áÑôùí‰ÕI•Á½ÉÑQ•áÐ¹±•¹Ñ¡ô¼ÐÀÀÀ¡…É…Ñ•ÉÌð½Q•áÐø4(€€€€€€€€€€€€ñA¥±±	ÕÑÑ½¸4(€€€€€€€€€€€€€±…‰•°õí‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ€ü€‰M•¹‘¥¹œÉ•Á½ÉÐ¸¸¸ˆ€è€‰M•¹‰ÕœÉ•Á½ÉÐ‰ô4(€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€¥˜€ …‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ¤‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ” ¤ì4(€€€€€€€€€€€€€õô4(€€€€€€€€€€€€¼ø4(€€€€€€€€€€€í‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹‘…Ñ„€ü€ 4(€€€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥I•ÍÕ±Ñôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹‘¥…¹½ÍÑ¥MÕ•ÍÍôù	ÕœÉ•Á½ÉÐÍ•¹Ðð½Q•áÐø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Ù…±Õ•ôùI•Á½ÉÐ%èí‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹‘…Ñ„¹É•Á½ÉÑ%‘ôð½Q•áÐø4(€€€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(€€€€€€€€€€€í‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹•ÉÉ½È€ü€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹•ÉÉ½Éôùí‰ÕI•Á½ÉÑ5ÕÑ…Ñ¥½¸¹•ÉÉ½È¹µ•ÍÍ…•ôð½Q•áÐø€è¹Õ±±ô4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€ð½½Éµ5½‘…°ø4(4(€€€€€€ñ5½‘…°ÑÉ…¹ÍÁ…É•¹ÐÙ¥Í¥‰±”õí¥Í%µÁ½ÉÑ5½‘…±=Á•¹ô…¹¥µ…Ñ¥½¹QåÁ”ô‰™…‘”ˆ½¹I•ÅÕ•ÍÑ±½Í”õì ¤€ôøÍ•Ñ%Í%µÁ½ÉÑ5½‘…±=Á•¸¡™…±Í”¥ôø4(€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±MÉ¥µôø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õímÍÑå±•Ì¹µ½‘…±…É°ìÝ¥‘Ñ èµ½‘…±…É‘]¥‘Ñ õuôø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±Q¥Ñ±•ôù½Áä±½…°‘…Ñ„¥¹Ñ¼Må¹Œ½‘”…½Õ¹Ðð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±	½‘åôø4(€€€€€€€€€€€€€Q¡¥Ì½Á¥•Ì…Ñ•½É¥•Ì…¹ÑÉ…¹Í…Ñ¥½¹Ì™É½´Ñ¡”±½…°•Ù¥”µ%ÁÉ½™¥±”¥¹Ñ¼Ñ¡”±¥¹­•Må¹Œ½‘”…½Õ¹Ð¸Q¡”±½…°ÁÉ½™¥±”ÍÑ…åÌ½¸Ñ¡¥Ì‘•Ù¥”¸4(€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±Ñ¥½¹Íôø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”ÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹ô½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ%Í%µÁ½ÉÑ5½‘…±=Á•¸¡™…±Í”¥ôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹Q•áÑôù…¹•°ð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹ô4(€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€¥˜€ …‘•Ù¥•AÉ½™¥±”ü¹ÕÍ•È¤ì4(€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€¥µÁ½ÉÑ•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ”¡ì4(€€€€€€€€€€€€€€€€€€€Í½ÕÉ•UÍ•É%è‘•Ù¥•AÉ½™¥±”¹ÕÍ•È¹¥°4(€€€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹Q•áÑôùí¥µÁ½ÉÑ•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ€ü€‰½Áå¥¹œ¸¸¸ˆ€è€‰½Áä‘…Ñ„‰ôð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€ð½5½‘…°ø4(4(€€€€€€ñ5½‘…°ÑÉ…¹ÍÁ…É•¹ÐÙ¥Í¥‰±”õí¥Í=Ý¹%Ñ5½‘…±=Á•¹ô…¹¥µ…Ñ¥½¹QåÁ”ô‰™…‘”ˆ½¹I•ÅÕ•ÍÑ±½Í”õì ¤€ôøÍ•Ñ%Í=Ý¹%Ñ5½‘…±=Á•¸¡™…±Í”¥ôø4(€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±MÉ¥µôø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õímÍÑå±•Ì¹µ½‘…±…É°ìÝ¥‘Ñ èµ½‘…±…É‘]¥‘Ñ õuôø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±Q¥Ñ±•ôù=Ý¸Ñ¡¥Ì‘•Ù¥”Ý¥Ñ Må¹Œ½‘”‘…Ñ„ð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±	½‘åôø4(€€€€€€€€€€€€€Q¡¥Ì½Ù•ÉÝÉ¥Ñ•ÌÑ¡”±½…°•Ù¥”µ%‘…Ñ„½¸Ñ¡¥Ì‘•Ù¥”Ý¥Ñ Ñ¡”ÕÉÉ•¹ÐMå¹Œ½‘”…½Õ¹Ð‘…Ñ„¸Q¡”±¥¹­•Må¹Œ½‘”…½Õ¹ÐÍÑ…åÌ½¹¹•Ñ•°‰ÕÐÑ¡”½±±½…°µ½¹±äÉ•½É‘Ì½¸Ñ¡¥Ì‘•Ù¥”Ý¥±°‰”É•Á±…•¸4(€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±MÑ…­Ñ¥½¹Íôø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”ÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹ô½¹AÉ•ÍÌõì ¤€ôøÍ•Ñ%Í=Ý¹%Ñ5½‘…±=Á•¸¡™…±Í”¥ôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹Q•áÑôù…¹•°ð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹ô4(€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€½Ý¹•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ”¡Õ¹‘•™¥¹•°ì4(€€€€€€€€€€€€€€€€€€€½¹MÕ•ÍÌè€¡ì‘•Ù¥•UÍ•Èô¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•áÑ•Ù¥•AÉ½™¥±”€ô‘•Ù¥•AÉ½™¥±”ì4(€€€€€€€€€€€€€€€€€€€€€¥˜€ …¹•áÑ•Ù¥•AÉ½™¥±”¤ì4(€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€Í•ÍÍ¥½¹MÑ½É”¹•ÑMÑ…Ñ” ¤¹Í•ÑM•ÍÍ¥½¸ 4(€€€€€€€€€€€€€€€€€€€€€€€ì4(€€€€€€€€€€€€€€€€€€€€€€€€€…•ÍÍQ½­•¸è¹•áÑ•Ù¥•AÉ½™¥±”¹…•ÍÍQ½­•¸°4(€€€€€€€€€€€€€€€€€€€€€€€€€É•™É•Í¡Q½­•¸è¹•áÑ•Ù¥•AÉ½™¥±”¹É•™É•Í¡Q½­•¸°4(€€€€€€€€€€€€€€€€€€€€€€€€€ÕÍ•Èè‘•Ù¥•UÍ•È°4(€€€€€€€€€€€€€€€€€€€€€€€ô°4(€€€€€€€€€€€€€€€€€€€€€€€€‰‘•Ù¥”ˆ°4(€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€ô°4(€€€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹Q•áÑôø4(€€€€€€€€€€€€€€€€€í½Ý¹•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ€ü€‰ÁÁ±å¥¹œ¸¸¸ˆ€è€‰=Ý¸¥Ð…¹ÕÍ”•Ù¥”µ%‰ô4(€€€€€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹ô4(€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€½Ý¹•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹µÕÑ…Ñ” ¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹ÁÉ¥µ…Éå	ÕÑÑ½¹Q•áÑôø4(€€€€€€€€€€€€€€€€€í½Ý¹•Ù¥•…Ñ…5ÕÑ…Ñ¥½¸¹¥ÍA•¹‘¥¹œ€ü€‰ÁÁ±å¥¹œ¸¸¸ˆ€è€‰=Ý¸¥Ð…¹ÍÑ…ä½¸Må¹Œ½‘”‰ô4(€€€€€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€ð½5½‘…°ø4(4(€€€€€€ñ5½‘…°4(€€€€€€€ÑÉ…¹ÍÁ…É•¹Ð4(€€€€€€€Ù¥Í¥‰±”õí	½½±•…¸¡Á•¹‘¥¹½É•ÑAÉ½™¥±•%¥ô4(€€€€€€€…¹¥µ…Ñ¥½¹QåÁ”ô‰™…‘”ˆ4(€€€€€€€½¹I•ÅÕ•ÍÑ±½Í”õì ¤€ôøÍ•ÑA•¹‘¥¹½É•ÑAÉ½™¥±•%¡¹Õ±°¥ô4(€€€€€€ø4(€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±MÉ¥µôø4(€€€€€€€€€€ñY¥•ÜÍÑå±”õímÍÑå±•Ì¹µ½‘…±…É°ìÝ¥‘Ñ èµ½‘…±…É‘]¥‘Ñ õuôø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±Q¥Ñ±•ôù½É•ÐMå¹ŒÁÉ½™¥±”ð½Q•áÐø4(€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹µ½‘…±	½‘åôø4(€€€€€€€€€€€€€Q¡¥ÌÉ•µ½Ù•ÌÑ¡”É•µ•µ‰•É•Må¹Œ½‘”ÁÉ½™¥±”™É½´Ñ¡¥Ì‘•Ù¥”½¹±ä¸Q¡”É•µ½Ñ”…½Õ¹Ð…¹¥ÑÌ‘…Ñ„ÍÑ…äÕ¹¡…¹•¸e½ÕÈ±½…°•Ù¥”µ%ÁÉ½™¥±”ÍÑ…åÌ…Ù…¥±…‰±”¡•É”°…¹Ñ¡¥Ì‘•Ù¥”Ý¥±°ÍÝ¥Ñ ‰…¬Ñ¼•Ù¥”µ%…™Ñ•È™½É•ÑÑ¥¹œÑ¡¥ÌÍå¹ŒÁÉ½™¥±”¸4(€€€€€€€€€€€€ð½Q•áÐø4(€€€€€€€€€€€€ñY¥•ÜÍÑå±”õíÍÑå±•Ì¹µ½‘…±Ñ¥½¹Íôø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”ÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹ô½¹AÉ•ÍÌõì ¤€ôøÍ•ÑA•¹‘¥¹½É•ÑAÉ½™¥±•%¡¹Õ±°¥ôø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹Í•½¹‘…Éå	ÕÑÑ½¹Q•áÑôù…¹•°ð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€€€ñAÉ•ÍÍ…‰±”4(€€€€€€€€€€€€€€€ÍÑå±”õíÍÑå±•Ì¹‘…¹•É	ÕÑÑ½¹ô4(€€€€€€€€€€€€€€€½¹AÉ•ÍÌõì ¤€ôøì4(€€€€€€€€€€€€€€€€€¥˜€ …Á•¹‘¥¹½É•ÑAÉ½™¥±•%¤ì4(€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€É•µ½Ù•1¥¹­•‘AÉ½™¥±”¡Á•¹‘¥¹½É•ÑAÉ½™¥±•%¤ì4(€€€€€€€€€€€€€€€€€Í•ÑA•¹‘¥¹½É•ÑAÉ½™¥±•%¡¹Õ±°¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñQ•áÐÍÑå±”õíÍÑå±•Ì¹‘…¹•É	ÕÑÑ½¹Q•áÑôù½É•Ðð½Q•áÐø4(€€€€€€€€€€€€€€ð½AÉ•ÍÍ…‰±”ø4(€€€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€€€ð½Y¥•Üø4(€€€€€€€€ð½Y¥•Üø4(€€€€€€ð½5½‘…°ø4(€€€€ð½MÉ••¹½¹Ñ…¥¹•Èø4(€€¤ì4)ô4(4)½¹ÍÐÍÑå±•Ì€ôMÑå±•M¡••Ð¹É•…Ñ”¡ì4(€½µÁ…ÑM•ÑÑ¥¹Í…Éèì4(€€€…Àè€ÄÈ°4(€€€Á…‘‘¥¹œè€ÄÐ°4(€ô°4(€ÁÉ½™¥±•…ÑÌèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÈ°4(€ô°4(€ÁÉ½™¥±•…Ðèì4(€€€™±•àè€Ä°4(€€€µ¥¹]¥‘Ñ è€ÄÌÈ°4(€ô°4(€±¥ÍÐèì4(€€€…Àè€ÄÀ°4(€ô°4(€±…‰•°èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹±…‰•°°4(€ô°4(€±…‰•±]¥Ñ¡!•±Àèì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€à°4(€ô°4(€Ù…±Õ”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹ÍÕ‰¡•…‘¥¹œ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€ÍÝ¥Ñ¡	±½¬èì4(€€€…Àè€à°4(€ô°4(€ÍÝ¥Ñ¡I½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÀ°4(€ô°4(€ÍÝ¥Ñ¡1¥ÍÐèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÀ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€ô°4(€±¥¹­•‘AÉ½™¥±•I½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€…Àè€à°4(€ô°4(€É…¹•5½‘•I½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÀ°4(€ô°4(€É…¹•‘¥Ñ½Èèì4(€€€…Àè€ÄÀ°4(€ô°4(€…•¹Ñ‘¥Ñ½Èèì4(€€€…Àè€Ø°4(€ô°4(€…•¹Ñ!•…‘•ÉI½Üèì4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰ÍÁ…”µ‰•ÑÝ••¸ˆ°4(€€€…Àè€à°4(€ô°4(€½±½É‘¥Ñ½ÉI½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€™±•á]É…Àè€‰ÝÉ…Àˆ°4(€€€…Àè€ÄÀ°4(€ô°4(€½±½É1…‰•°èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€™½¹ÑM¥é”è€ÄÐ°4(€€€±¥¹•!•¥¡Ðè€ÈÀ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€€€Ý¥‘Ñ è€ÜØ°4(€ô°4(€…•¹ÑAÉ•Ù¥•Üèì4(€€€Ý¥‘Ñ è€ÌÐ°4(€€€¡•¥¡Ðè€ÌÐ°4(€€€‰½É‘•ÉI…‘¥ÕÌè€ÄÜ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€ô°4(€½±½ÉAÉ•Ù¥•Üèì4(€€€Ý¥‘Ñ è€ÐÈ°4(€€€¡•¥¡Ðè€ÌØ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹Í´°4(€€€½Ù•É™±½Üè€‰¡¥‘‘•¸ˆ°4(€ô°4(€½±½ÉA¥­•Èèì4(€€€Á½Í¥Ñ¥½¸è€‰…‰Í½±ÕÑ”ˆ°4(€€€Ñ½Àè€À°4(€€€É¥¡Ðè€À°4(€€€‰½ÑÑ½´è€À°4(€€€±•™Ðè€À°4(€€€Á…‘‘¥¹œè€À°4(€€€½Á…¥Ñäè€À°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ìÕÉÍ½Èè€‰Á½¥¹Ñ•Èˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€…•¹Ñ%¹ÁÕÐèì4(€€€Ý¥‘Ñ è€ÄÈÀ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÀ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì½ÕÑ±¥¹•]¥‘Ñ è€À°½ÕÑ±¥¹•½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€É…¹•¥•±èì4(€€€…Àè€Ø°4(€ô°4(€ÕÉÉ•¹åI½Üèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€…±¥¹%Ñ•µÌè€‰•¹Ñ•Èˆ°4(€€€…Àè€ÄÈ°4(€ô°4(€É…¹•%¹ÁÕÐèì4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÀ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì½ÕÑ±¥¹•]¥‘Ñ è€À°½ÕÑ±¥¹•½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€ÕÉÉ•¹å%¹ÁÕÐèì4(€€€Ý¥‘Ñ è€àà°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÀ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€Äà°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì½ÕÑ±¥¹•]¥‘Ñ è€À°½ÕÑ±¥¹•½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€•ÉÉ½Èèì4(€€€µ…É¥¹Q½Àè€à°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹Ý…É¹¥¹œ°4(€€€™½¹ÑM¥é”è€ÄÐ°4(€€€±¥¹•!•¥¡Ðè€ÈÀ°4(€ô°4(€¡•±Á•ÉQ•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹±…‰•°°4(€ô°4(€‘¥…¹½ÍÑ¥1¥ÍÐèì4(€€€…Àè€ÄÐ°4(€ô°4(€‘¥…¹½ÍÑ¥%Ñ•´èì4(€€€…Àè€ÄÈ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€Á…‘‘¥¹œè€ÄØ°4(€ô°4(€‘¥…¹½ÍÑ¥%Ñ•µQ¥Ñ±”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹ÍÕ‰¡•…‘¥¹œ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€ô°4(€‰ÕI•Á½ÉÑ%¹ÁÕÐèì4(€€€µ¥¹!•¥¡Ðè€ÄÈÀ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄÐ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…É°4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€±¥¹•!•¥¡Ðè€ÈÄ°4(€€€Ñ•áÑ±¥¹Y•ÉÑ¥…°è€‰Ñ½Àˆ°4(€€€€¸¸¸¡A±…Ñ™½É´¹=L€ôôô€‰Ý•ˆˆ€ü€¡ì½ÕÑ±¥¹•]¥‘Ñ è€À°½ÕÑ±¥¹•½±½Èè€‰ÑÉ…¹ÍÁ…É•¹Ðˆ°É•Í¥é”è€‰Ù•ÉÑ¥…°ˆô…Ì…¹ä¤€èíô¤°4(€ô°4(€‘¥…¹½ÍÑ¥I•ÍÕ±Ðèì4(€€€…Àè€Ø°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹µ°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹™¥•±°4(€€€Á…‘‘¥¹œè€ÄÐ°4(€ô°4(€‘¥…¹½ÍÑ¥MÕ•ÍÌèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹ÍÕ•ÍÌ°4(€€€™½¹ÑM¥é”è€ÄØ°4(€€€±¥¹•!•¥¡Ðè€ÈÈ°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€ô°4(€Í¥¹=ÕÑ	ÕÑÑ½¸èì4(€€€…±¥¹M•±˜è€‰™±•àµÍÑ…ÉÐˆ°4(€€€‰½É‘•ÉI…‘¥ÕÌè€äää°4(€€€‰…­É½Õ¹‘½±½Èè€ˆÉÈˆ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄØ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€Í¥¹=ÕÑ	ÕÑÑ½¹Q•áÐèì4(€€€½±½Èè€ˆäÅÅˆ°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹½¹ÑÉ½°°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€µ½‘…±MÉ¥´èì4(€€€™±•àè€Ä°4(€€€‰…­É½Õ¹‘½±½Èè€‰É‰„ ÈÜ°€Èä°€ÌÄ°€À¸ÌÔ¤ˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰•¹Ñ•Èˆ°4(€€€Á…‘‘¥¹œè€ÈÀ°4(€ô°4(€µ½‘…±…Éèì4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…É°4(€€€‰½É‘•ÉI…‘¥ÕÌèÑ¡•µ”¹É…‘¥ÕÌ¹±œ°4(€€€Á…‘‘¥¹œè€ÈÀ°4(€€€…Àè€ÄÐ°4(€€€‰½É‘•É]¥‘Ñ è€Ä°4(€€€‰½É‘•É½±½ÈèÑ¡•µ”¹½±½ÉÌ¹‰½É‘•È°4(€€€µ…á]¥‘Ñ è€ÔØÀ°4(€€€…±¥¹M•±˜è€‰•¹Ñ•Èˆ°4(€€€€¸¸¹Ñ¡•µ”¹Í¡…‘½Ü°4(€ô°4(€µ½‘…±Q¥Ñ±”èì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹¥¹¬°4(€€€™½¹ÑM¥é”è€ÈÈ°4(€€€±¥¹•!•¥¡Ðè€Èà°4(€€€™½¹Ñ]•¥¡Ðè€ˆàÀÀˆ°4(€ô°4(€µ½‘…±	½‘äèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹µÕÑ•°4(€€€€¸¸¹Ñ¡•µ”¹ÑåÁ½É…Á¡ä¹‰½‘ä°4(€ô°4(€µ½‘…±Ñ¥½¹Ìèì4(€€€™±•á¥É•Ñ¥½¸è€‰É½Üˆ°4(€€€©ÕÍÑ¥™å½¹Ñ•¹Ðè€‰™±•àµ•¹ˆ°4(€€€…Àè€ÄÀ°4(€ô°4(€µ½‘…±MÑ…­Ñ¥½¹Ìèì4(€€€…Àè€ÄÀ°4(€ô°4(€Í•½¹‘…Éå	ÕÑÑ½¸èì4(€€€‰½É‘•ÉI…‘¥ÕÌè€äää°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑM½™Ð°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€ÄØ°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€Í•½¹‘…Éå	ÕÑÑ½¹Q•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑM½™ÑQ•áÐ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€ÁÉ¥µ…Éå	ÕÑÑ½¸èì4(€€€‰½É‘•ÉI…‘¥ÕÌè€äää°4(€€€‰…­É½Õ¹‘½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹Ð°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Äà°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€ÁÉ¥µ…Éå	ÕÑÑ½¹Q•áÐèì4(€€€½±½ÈèÑ¡•µ”¹½±½ÉÌ¹…•¹ÑQ•áÐ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4(€‘…¹•É	ÕÑÑ½¸èì4(€€€‰½É‘•ÉI…‘¥ÕÌè€äää°4(€€€‰…­É½Õ¹‘½±½Èè€ˆäÅÅˆ°4(€€€Á…‘‘¥¹!½É¥é½¹Ñ…°è€Äà°4(€€€Á…‘‘¥¹Y•ÉÑ¥…°è€ÄÈ°4(€ô°4(€‘…¹•É	ÕÑÑ½¹Q•áÐèì4(€€€½±½Èè€ˆˆ°4(€€€™½¹Ñ]•¥¡Ðè€ˆÜÀÀˆ°4(€ô°4)ô¤ì4