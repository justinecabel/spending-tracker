import { StyleSheet, Text, View } from "react-native";
import { usePwaInstallContext } from "../hooks/use-pwa-install";
import { theme } from "../theme";
import { PillButton, SectionTitle } from "./ui";

export function InstallPanel() {
  const { canInstall, install, isInstalled } = usePwaInstallContext();

  return (
    <View style={styles.panel}>
      <SectionTitle
        title="Install app"
        subtitle={
          isInstalled
            ? "This web app is already installed on this device."
            : canInstall
              ? "Install this tracker. Your active profile's custom accent, device ID, saved profiles, login session, and offline changes will stay with the app."
              : "If your browser supports installation, the install action will appear here."
        }
      />
      <PillButton
        label={isInstalled ? "Installed" : canInstall ? "Install app" : "Install unavailable"}
        tone="ghost"
        onPress={canInstall ? () => void install() : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 14,
  },
});
