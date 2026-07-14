import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Card, PageHeader, PillButton, SectionTitle } from "../../src/components/ui";
import { InstallPanel } from "../../src/components/install-panel";
import { usePwaInstallContext } from "../../src/hooks/use-pwa-install";
import { ScreenContainer } from "../../src/components/layout";
import { TransferOutPanel } from "../../src/components/transfer-session";
import { api } from "../../src/lib/api";
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
  const { isInstalled } = usePwaInstallContext();
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
      <Card>
        <View style={styles.list}>
          <View>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{user?.name ?? "Unknown"}</Text>
          </View>
          <View>
            <Text style={styles.label}>Login mode</Text>
            <Text style={styles.value}>{loginMode}</Text>
          </View>
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
      {!isInstalled ? (
        <Card>
          <InstallPanel />
        </Card>
      ) : null}

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
            <Text style={styles.label}>Paydays</Text>
            <TextInput
              value={smartPaydays}
              onChangeText={setSmartPaydays}
              placeholder="15,30"
              style={styles.rangeInput}
            />
            <Text style={styles.helperText}>Comma-separated days of the month. Example: `15,30` or `5,20,30`.</Text>
          </View>
        ) : null}
      </Card>

      <Card>
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
          <Text style={styles.label}>Custom colors</Text>
          <View style={styles.colorEditorRow}>
            <Text style={styles.colorLabel}>Primary</Text>
            <View style={[styles.colorPreview, { backgroundColor: normalizeCustomAccent(accentDraft) ?? theme.colors.accent }]}>
              <TextInput
                value={normalizeCustomAccent(accentDraft) ?? "#0F766E"}
                onChangeText={(value) => {
                  setAccentDraft(value.toUpperCase().slice(0, 7));
                  setAccentError(null);
                }}
                style={styles.colorPicker}
                {...(Platform.OS === "web" ? ({ type: "color", "aria-label": "Primary color" } as any) : {})}
              />
            </View>
            <TextInput
              value={accentDraft}
              onChangeText={(value) => {
                setAccentDraft(value.toUpperCase().slice(0, 7));
                setAccentError(null);
              }}
              placeholder="#0F766E"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={styles.accentInput}
            />
          </View>
          <View style={styles.colorEditorRow}>
            <Text style={styles.colorLabel}>Secondary</Text>
            <View style={[styles.colorPreview, { backgroundColor: normalizeCustomAccent(secondaryAccentDraft) ?? theme.colors.accentSoft }]}>
              <TextInput
                value={normalizeCustomAccent(secondaryAccentDraft) ?? "#D9F3EF"}
                onChangeText={(value) => {
                  setSecondaryAccentDraft(value.toUpperCase().slice(0, 7));
                  setAccentError(null);
                }}
                style={styles.colorPicker}
                {...(Platform.OS === "web" ? ({ type: "color", "aria-label": "Secondary color" } as any) : {})}
              />
            </View>
            <TextInput
              value={secondaryAccentDraft}
              onChangeText={(value) => {
                setSecondaryAccentDraft(value.toUpperCase().slice(0, 7));
                setAccentError(null);
              }}
              placeholder="#D9F3EF"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={styles.accentInput}
            />
          </View>
          <View style={styles.accentInputRow}>
            <PillButton
              label="Save colors"
              tone="ghost"
              onPress={() => {
                const nextAccent = normalizeCustomAccent(accentDraft);
                const nextSecondaryAccent = normalizeCustomAccent(secondaryAccentDraft);
                if (!nextAccent || !nextSecondaryAccent) {
                  setAccentError("Enter two 6-digit hex colors, for example #7C3AED and #EDE9FE.");
                  return;
                }
                setAppearanceAccent(appearanceProfileKey, nextAccent);
                setAppearanceSecondaryAccent(appearanceProfileKey, nextSecondaryAccent);
                setAccentDraft(nextAccent);
                setSecondaryAccentDraft(nextSecondaryAccent);
                setAccentError(null);
              }}
            />
          </View>
          {customAccent || customSecondaryAccent ? (
            <PillButton
              label="Use theme default"
              tone="ghost"
              onPress={() => {
                setAppearanceAccent(appearanceProfileKey, null);
                setAppearanceSecondaryAccent(appearanceProfileKey, null);
                setAccentDraft("");
                setSecondaryAccentDraft("");
                setAccentError(null);
              }}
            />
          ) : null}
          {accentError ? <Text style={styles.error}>{accentError}</Text> : null}
          <Text style={styles.helperText}>Primary changes buttons and highlights. Secondary changes soft selected and supporting surfaces.</Text>
        </View>
      </Card>

      {canImportLocalData ? (
        <Card>
          <SectionTitle
            title="Import local Device-ID data"
            subtitle="Copy the local Device-ID profile records into this Sync Code account without deleting the local profile."
          />
          <PillButton label="Copy local data" tone="ghost" onPress={() => setIsImportModalOpen(true)} />
          {importDeviceDataMutation.error ? <Text style={styles.error}>{importDeviceDataMutation.error.message}</Text> : null}
        </Card>
      ) : null}

      {canForgetLinkedProfile ? (
        <Card>
          <SectionTitle
            title="Forget this Sync Code profile"
            subtitle="Remove this remembered Sync Code profile from this device only. The remote account stays unchanged and this device will switch back to Device-ID."
          />
          <PillButton
            label="Forget profile"
            tone="ghost"
            onPress={() => {
              if (!activeLinkedProfileUserId) {
                return;
              }
              setPendingForgetProfileId(activeLinkedProfileUserId);
            }}
          />
        </Card>
      ) : null}

      {canOwnDeviceData ? (
        <Card>
          <SectionTitle
            title="Own this device"
            subtitle="Replace the local Device-ID records on this device with the current Sync Code account data."
          />
          <PillButton
            label="Own it"
            tone="ghost"
            onPress={() => {
              ownDeviceDataMutation.reset();
              setIsOwnItModalOpen(true);
            }}
          />
          {ownDeviceDataMutation.error ? <Text style={styles.error}>{ownDeviceDataMutation.error.message}</Text> : null}
        </Card>
      ) : null}

      <Card>
        <TransferOutPanel />
      </Card>

      <Modal transparent visible={isImportModalOpen} animationType="fade" onRequestClose={() => setIsImportModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, { width: modalCardWidth }]}>
            <Text style={styles.modalTitle}>Copy local data into Sync Code account</Text>
            <Text style={styles.modalBody}>
              This copies categories and transactions from the local Device-ID profile into the linked Sync Code account. The local profile stays on this device.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setIsImportModalOpen(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  if (!deviceProfile?.user) {
                    return;
                  }
                  importDeviceDataMutation.mutate({
                    sourceUserId: deviceProfile.user.id,
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>{importDeviceDataMutation.isPending ? "Copying..." : "Copy data"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={isOwnItModalOpen} animationType="fade" onRequestClose={() => setIsOwnItModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, { width: modalCardWidth }]}>
            <Text style={styles.modalTitle}>Own this device with Sync Code data</Text>
            <Text style={styles.modalBody}>
              This overwrites the local Device-ID data on this device with the current Sync Code account data. The linked Sync Code account stays connected, but the old local-only records on this device will be replaced.
            </Text>
            <View style={styles.modalStackActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setIsOwnItModalOpen(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  ownDeviceDataMutation.mutate(undefined, {
                    onSuccess: ({ deviceUser }) => {
                      const nextDeviceProfile = deviceProfile;
                      if (!nextDeviceProfile) {
                        return;
                      }
                      sessionStore.getState().setSession(
                        {
                          accessToken: nextDeviceProfile.accessToken,
                          refreshToken: nextDeviceProfile.refreshToken,
                          user: deviceUser,
                        },
                        "device",
                      );
                    },
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {ownDeviceDataMutation.isPending ? "Applying..." : "Own it and use Device-ID"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  ownDeviceDataMutation.mutate();
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {ownDeviceDataMutation.isPending ? "Applying..." : "Own it and stay on Sync Code"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={Boolean(pendingForgetProfileId)}
        animationType="fade"
        onRequestClose={() => setPendingForgetProfileId(null)}
      >
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, { width: modalCardWidth }]}>
            <Text style={styles.modalTitle}>Forget Sync profile</Text>
            <Text style={styles.modalBody}>
              This removes the remembered Sync Code profile from this device only. The remote account and its data stay unchanged. Your local Device-ID profile stays available here, and this device will switch back to Device-ID after forgetting this sync profile.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setPendingForgetProfileId(null)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.dangerButton}
                onPress={() => {
                  if (!pendingForgetProfileId) {
                    return;
                  }
                  removeLinkedProfile(pendingForgetProfileId);
                  setPendingForgetProfileId(null);
                }}
              >
                <Text style={styles.dangerButtonText}>Forget</Text>
              </Pressable>
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
  label: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  value: {
    color: theme.colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  switchBlock: {
    gap: 8,
  },
  switchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  switchList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  linkedProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rangeModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  rangeEditor: {
    gap: 10,
  },
  accentEditor: {
    gap: 10,
  },
  accentInputRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  colorEditorRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  colorLabel: {
    color: theme.colors.muted,
    fontWeight: "700",
    width: 76,
  },
  accentPreview: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  colorPreview: {
    width: 42,
    height: 36,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  colorPicker: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 0,
    opacity: 0,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  accentInput: {
    width: 120,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.field,
    color: theme.colors.ink,
    fontSize: 16,
    fontWeight: "700",
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  rangeField: {
    gap: 6,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rangeInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.field,
    color: theme.colors.ink,
    fontSize: 16,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  currencyInput: {
    width: 88,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.field,
    color: theme.colors.ink,
    fontSize: 18,
    fontWeight: "700",
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineColor: "transparent" } as any) : {}),
  },
  error: {
    marginTop: 8,
    color: theme.colors.warning,
  },
  helperText: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  signOutButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  signOutButtonText: {
    color: "#B91C1C",
    fontSize: 15,
    fontWeight: "700",
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxWidth: 560,
    alignSelf: "center",
    ...theme.shadow,
  },
  modalTitle: {
    color: theme.colors.ink,
    fontSize: 22,
    fontWeight: "800",
  },
  modalBody: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalStackActions: {
    gap: 10,
  },
  secondaryButton: {
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: theme.colors.accentSoftText,
    fontWeight: "700",
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
  },
  dangerButton: {
    borderRadius: 999,
    backgroundColor: "#B91C1C",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  dangerButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
