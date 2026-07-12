import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api } from "../src/lib/api";
import { ScreenContainer } from "../src/components/layout";
import { Card, PageHeader, PillButton, SectionTitle } from "../src/components/ui";
import { TransferInPanel } from "../src/components/transfer-session";
import { getDeviceId } from "../src/lib/device";
import { sessionStore } from "../src/state/session";
import { theme } from "../src/theme";

export default function SignInScreen() {
  const setSession = sessionStore((state) => state.setSession);
  const activateProfile = sessionStore((state) => state.activateProfile);
  const linkedProfiles = sessionStore((state) => state.linkedProfiles);
  const removeLinkedProfile = sessionStore((state) => state.removeLinkedProfile);
  const [hasRememberedDevice, setHasRememberedDevice] = useState(false);

  useEffect(() => {
    let active = true;

    void getDeviceId().then((deviceId) => {
      if (!active) {
        return;
      }
      setHasRememberedDevice(Boolean(deviceId));
    });

    return () => {
      active = false;
    };
  }, []);

  const deviceSignInMutation = useMutation({
    mutationFn: api.signInWithDevice,
    onSuccess: (result) => {
      setSession(result, "device");
    },
  });

  return (
    <ScreenContainer screenKey="sign-in">
      <View style={styles.authColumn}>
        <PageHeader
          title="Sign in"
          subtitle="Continue with this device ID or link this device to an existing account."
        />
      </View>

      <Card style={styles.authCard}>
        <SectionTitle
          title="Using Device ID"
          subtitle={
            hasRememberedDevice
              ? "Use the device profile already stored here."
              : "Start with the device profile stored on this device."
          }
        />
        <View style={styles.actions}>
          <PillButton
            label="Continue"
            onPress={() => deviceSignInMutation.mutate()}
          />
        </View>
        {deviceSignInMutation.error ? <Text style={styles.error}>{deviceSignInMutation.error.message}</Text> : null}
      </Card>

      <Card style={styles.authCard}>
        <TransferInPanel
          rememberedLinkedProfiles={linkedProfiles}
          onUseRememberedProfile={(userId) => activateProfile("linked", userId)}
          onForgetRememberedProfile={removeLinkedProfile}
          onSuccess={(session) => setSession(session, "linked")}
        />
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  authColumn: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  authCard: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: 18,
  },
  actions: {
    marginTop: 12,
  },
  error: {
    marginTop: 10,
    color: theme.colors.warning,
  },
});
