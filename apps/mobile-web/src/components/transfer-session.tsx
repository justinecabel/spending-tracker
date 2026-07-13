import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import type { AuthResponse } from "@spending-tracker/shared";
import { api } from "../lib/api";
import type { StoredProfileSession } from "../state/session";
import { sessionStore } from "../state/session";
import { theme } from "../theme";
import { WebPressable as Pressable } from "./web-pressable";
import { PillButton, SectionTitle } from "./ui";

export function TransferOutPanel() {
  const userId = sessionStore((state) => state.user?.id);
  const [visibleCode, setVisibleCode] = useState<Awaited<ReturnType<typeof api.createTransferToken>> | null>(null);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const transferMutation = useMutation({
    mutationFn: api.createTransferToken,
    onSuccess: (result) => {
      setVisibleCode(result);
    },
  });
  const regenerateMutation = useMutation({
    mutationFn: api.regenerateTransferToken,
    onSuccess: (result) => {
      setVisibleCode(result);
      setIsRegenerateModalOpen(false);
    },
  });

  useEffect(() => {
    setVisibleCode(null);
    transferMutation.reset();
    regenerateMutation.reset();
    // reset visible sync-code state when the active stored profile changes
  }, [userId]);

  return (
    <View style={styles.panel}>
      <SectionTitle
        title="Transfer/sync access"
        subtitle="Show a stable code for this account. Regenerating it disconnects the old code for future joins."
      />
      {visibleCode ? (
        <View style={styles.codeOnlyLayout}>
          <Text style={styles.metaLabel}>Sync code</Text>
          <Text style={styles.codeText}>{visibleCode.pairingCode}</Text>
          <View style={styles.inlineActions}>
            <PillButton
              label={regenerateMutation.isPending ? "Regenerating..." : "Regenerate code"}
              tone="ghost"
              onPress={() => setIsRegenerateModalOpen(true)}
            />
          </View>
        </View>
      ) : (
        <PillButton
          label={transferMutation.isPending ? "Loading..." : "Show Code"}
          tone="ghost"
          onPress={() => transferMutation.mutate()}
        />
      )}
      {transferMutation.error ? <Text style={styles.error}>{transferMutation.error.message}</Text> : null}
      {regenerateMutation.error ? <Text style={styles.error}>{regenerateMutation.error.message}</Text> : null}

      <Modal transparent visible={isRegenerateModalOpen} animationType="fade" onRequestClose={() => setIsRegenerateModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Regenerate sync code</Text>
            <Text style={styles.modalBody}>
              This creates a new code for future joins. Anyone using the old code will need the new one.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setIsRegenerateModalOpen(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  regenerateMutation.mutate();
                }}
              >
                <Text style={styles.primaryButtonText}>{regenerateMutation.isPending ? "Working..." : "Regenerate"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function TransferInPanel({
  onSuccess,
  rememberedLinkedProfiles,
  onUseRememberedProfile,
  onForgetRememberedProfile,
}: {
  onSuccess: (session: AuthResponse) => void;
  rememberedLinkedProfiles: StoredProfileSession[];
  onUseRememberedProfile: (userId: string) => void;
  onForgetRememberedProfile: (userId: string) => void;
}) {
  const [manualToken, setManualToken] = useState("");
  const [showInvalidCodeModal, setShowInvalidCodeModal] = useState(false);
  const [revealedDeleteUserId, setRevealedDeleteUserId] = useState<string | null>(null);
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  const consumeMutation = useMutation({
    mutationFn: (token: string) => api.consumeTransferToken({ token }),
    onSuccess,
    onError: () => {
      setShowInvalidCodeModal(true);
    },
  });

  const handleToken = (value: string) => {
    const token = value.trim();
    if (!token || consumeMutation.isPending) {
      return;
    }
    consumeMutation.reset();
    consumeMutation.mutate(token);
  };

  return (
    <View style={styles.panel}>
      <SectionTitle
        title="Link to existing account"
        subtitle={
          rememberedLinkedProfiles.length > 0
            ? "Use a remembered Sync Code profile below, or add another one with a pairing code."
            : "Add a Sync Code profile to this device. Your Device-ID profile stays available here."
        }
      />
      {rememberedLinkedProfiles.length > 0 ? (
        <View style={styles.savedProfiles}>
          {rememberedLinkedProfiles.map((profile, index) => (
            <Pressable
              key={profile.user.id}
              style={styles.savedProfileRow}
              onPress={() => onUseRememberedProfile(profile.user.id)}
              onLongPress={() => {
                if (Platform.OS !== "web") {
                  setRevealedDeleteUserId((current) => (current === profile.user.id ? null : profile.user.id));
                }
              }}
              onHoverIn={() => {
                if (Platform.OS === "web") {
                  setHoveredUserId(profile.user.id);
                }
              }}
              onHoverOut={() => {
                if (Platform.OS === "web") {
                  setHoveredUserId((current) => (current === profile.user.id ? null : current));
                }
              }}
            >
              <View style={styles.savedProfileInfo}>
                <Text style={styles.savedProfileName}>{profile.user.name || `Sync ${index + 1}`}</Text>
                <Text style={styles.savedProfileMeta}>Tap to continue</Text>
              </View>
              {hoveredUserId === profile.user.id || revealedDeleteUserId === profile.user.id ? (
                <Pressable
                  style={styles.dismissButton}
                  onPress={() => {
                    onForgetRememberedProfile(profile.user.id);
                    setRevealedDeleteUserId((current) => (current === profile.user.id ? null : current));
                    setHoveredUserId((current) => (current === profile.user.id ? null : current));
                  }}
                >
                  <Text style={styles.dismissButtonText}>Delete</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.manualEntry}>
        <TextInput
          value={manualToken}
          onChangeText={setManualToken}
          placeholder="Enter pairing code"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          placeholderTextColor={theme.colors.muted}
        />
        <PillButton label={consumeMutation.isPending ? "Joining..." : "Join account"} onPress={() => handleToken(manualToken)} />
      </View>
      {consumeMutation.error && !showInvalidCodeModal ? <Text style={styles.error}>{consumeMutation.error.message}</Text> : null}

      <Modal transparent visible={showInvalidCodeModal} animationType="fade" onRequestClose={() => setShowInvalidCodeModal(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pairing code not found</Text>
            <Text style={styles.modalBody}>
              This pairing code does not exist or is no longer valid. Check the code and try again.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setShowInvalidCodeModal(false);
                }}
              >
                <Text style={styles.secondaryButtonText}>Close</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  setManualToken("");
                  consumeMutation.reset();
                  setShowInvalidCodeModal(false);
                }}
              >
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 14,
  },
  codeOnlyLayout: {
    gap: 14,
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaLabel: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  codeText: {
    color: theme.colors.ink,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  manualEntry: {
    gap: 8,
  },
  savedProfiles: {
    gap: 10,
  },
  savedProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderRadius: theme.radius.md,
  },
  savedProfileInfo: {
    gap: 2,
  },
  savedProfileName: {
    color: theme.colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  savedProfileMeta: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  dismissButton: {
    borderRadius: 999,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dismissButtonText: {
    color: "#B91C1C",
    fontWeight: "700",
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
  error: {
    color: theme.colors.warning,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(27, 29, 31, 0.35)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    alignSelf: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxWidth: 460,
    width: "100%",
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
  primaryButton: {
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
