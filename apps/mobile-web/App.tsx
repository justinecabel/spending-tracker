import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Platform, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import DashboardScreen from "./app/(app)/index";
import ReportsScreen from "./app/(app)/reports";
import SettingsScreen from "./app/(app)/settings";
import TransactionsScreen from "./app/(app)/transactions";
import SignInScreen from "./app/sign-in";
import { useBootstrapSession } from "./src/hooks/use-bootstrap";
import { useLiveUpdates } from "./src/hooks/use-live-updates";
import { useOfflineStatus } from "./src/hooks/use-offline-status";
import { PwaInstallContext, usePwaInstall } from "./src/hooks/use-pwa-install";
import { useSyncQueue } from "./src/hooks/use-sync";
import { Providers } from "./src/providers";
import { WebPressable as Pressable } from "./src/components/web-pressable";
import { appShellStore, normalizeTabKey, type TabKey } from "./src/state/app-shell";
import { appearanceStore } from "./src/state/appearance";
import { sessionStore } from "./src/state/session";
import { offlineQueueStore } from "./src/state/offline-queue";
import { applyThemeMode, getPalette, resolveAppearance, theme } from "./src/theme";

const tabs: Array<[TabKey, string]> = [
  ["home", "Home"],
  ["transactions", "Transactions"],
  ["reports", "Reports"],
  ["settings", "Settings"],
];

function parseTabFromLocation(): TabKey {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "home";
  }

  const match = window.location.hash.match(/^#\/(home|transactions|reports|settings)$/);
  return (match?.[1] as TabKey | undefined) ?? "home";
}

function buildTabUrl(tab: TabKey) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}#/${tab}`;
}

function AppShell() {
  const tab = appShellStore((state) => state.tab);
  const setTab = appShellStore((state) => state.setTab);
  const appearanceMode = appearanceStore((state) => state.mode);
  const hydrated = sessionStore((state) => state.hydrated);
  const accessToken = sessionStore((state) => state.accessToken);
  const activeProfile = sessionStore((state) => state.activeProfile);
  const pendingSyncCount = offlineQueueStore((state) => state.mutations.length);
  const deviceScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const queryClient = useQueryClient();
  const previousProfile = useRef(activeProfile);
  const previousAccessToken = useRef(Boolean(accessToken));
  const previousTab = useRef<TabKey | null>(tab);
  const handlingHistory = useRef(false);
  const historyReady = useRef(false);
  const isWeb = Platform.OS === "web" && typeof window !== "undefined";
  const activeTab = normalizeTabKey(tab);
  const { isOnline } = useOfflineStatus();

  useBootstrapSession();
  useSyncQueue(Boolean(accessToken));
  useLiveUpdates(Boolean(accessToken));

  useEffect(() => {
    applyThemeMode(appearanceMode, deviceScheme);
  }, [appearanceMode, deviceScheme]);

  const palette = getPalette(resolveAppearance(appearanceMode, deviceScheme));

  useEffect(() => {
    if (previousProfile.current === activeProfile) {
      return;
    }

    previousProfile.current = activeProfile;
    queryClient.removeQueries({ queryKey: ["categories"] });
    queryClient.removeQueries({ queryKey: ["transactions"] });
    queryClient.removeQueries({ queryKey: ["budgets"] });
    queryClient.removeQueries({ queryKey: ["report"] });
    queryClient.removeQueries({ queryKey: ["reports"] });
    queryClient.removeQueries({ queryKey: ["me"] });
  }, [activeProfile, queryClient]);

  useEffect(() => {
    if (activeTab !== tab) {
      setTab(activeTab);
    }
  }, [activeTab, setTab, tab]);

  useEffect(() => {
    if (!isWeb) {
      return;
    }

    const handlePopState = () => {
      if (!sessionStore.getState().accessToken) {
        return;
      }

      handlingHistory.current = true;
      setTab(parseTabFromLocation());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isWeb, setTab]);

  useEffect(() => {
    const hadAccessToken = previousAccessToken.current;
    const hasAccessToken = Boolean(accessToken);
    previousAccessToken.current = hasAccessToken;

    if (!isWeb) {
      return;
    }

    if (!hadAccessToken && hasAccessToken) {
      historyReady.current = true;
      previousTab.current = "home";
      handlingHistory.current = true;
      window.history.replaceState({ tab: "home" }, "", buildTabUrl("home"));
      setTab("home");
      return;
    }

    if (hadAccessToken && !hasAccessToken) {
      historyReady.current = false;
      previousTab.current = null;
      handlingHistory.current = false;
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [accessToken, isWeb, setTab]);

  useEffect(() => {
    if (!isWeb || !accessToken) {
      return;
    }

    if (!historyReady.current) {
      const locationTab = parseTabFromLocation();
      historyReady.current = true;

      if (locationTab !== activeTab) {
        handlingHistory.current = true;
        previousTab.current = locationTab;
        setTab(locationTab);
        window.history.replaceState({ tab: locationTab }, "", buildTabUrl(locationTab));
        return;
      }

      previousTab.current = activeTab;
      window.history.replaceState({ tab: activeTab }, "", buildTabUrl(activeTab));
      return;
    }

    if (handlingHistory.current) {
      handlingHistory.current = false;
      previousTab.current = activeTab;
      return;
    }

    if (previousTab.current !== activeTab) {
      previousTab.current = activeTab;
      window.history.pushState({ tab: activeTab }, "", buildTabUrl(activeTab));
    }
  }, [accessToken, activeTab, isWeb, setTab]);

  if (!hydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: palette.paper }]}>
        <View style={[styles.splashMark, { backgroundColor: palette.accent }]}>
          <Text style={styles.splashMarkText}>💸</Text>
        </View>
        <Text style={[styles.splashTitle, { color: palette.ink }]}>Spend</Text>
        <Text style={[styles.loadingText, { color: palette.muted }]}>Loading your tracker</Text>
      </View>
    );
  }

  if (!accessToken) {
    return <SignInScreen />;
  }

  return (
    <View style={[styles.app, { backgroundColor: palette.paper }]}>
      <View style={[styles.tabBarChrome, { borderBottomColor: palette.border, backgroundColor: palette.card }]}>
        {isWeb ? <View style={styles.safeAreaTopFill} /> : null}
        <View style={[styles.tabBar, { backgroundColor: palette.card }]}>
          {tabs.map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[
                styles.tab,
                compact && styles.tabCompact,
                { backgroundColor: palette.accentSoft },
                activeTab === key && [styles.tabActive, { backgroundColor: palette.accent }],
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  compact && styles.tabLabelCompact,
                  { color: palette.accent },
                  activeTab === key && styles.tabLabelActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {!isOnline || pendingSyncCount > 0 ? (
          <View style={[styles.syncBanner, { backgroundColor: isOnline ? palette.accentSoft : palette.field, borderTopColor: palette.border }]}>
            <Text style={[styles.syncBannerText, { color: isOnline ? palette.accent : palette.warning }]}>
              {isOnline
                ? `${pendingSyncCount} change${pendingSyncCount === 1 ? "" : "s"} waiting to sync`
                : `${pendingSyncCount ? `${pendingSyncCount} change${pendingSyncCount === 1 ? "" : "s"} saved locally · ` : ""}Offline mode — showing saved data`}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        {activeTab === "home" ? <DashboardScreen /> : null}
        {activeTab === "transactions" ? <TransactionsScreen /> : null}
        {activeTab === "reports" ? <ReportsScreen /> : null}
        {activeTab === "settings" ? <SettingsScreen /> : null}
      </View>
    </View>
  );
}

function AppWithPwaInstall() {
  const pwaInstall = usePwaInstall();

  return (
    <PwaInstallContext.Provider value={pwaInstall}>
      <AppShell />
    </PwaInstallContext.Provider>
  );
}

export default function App() {
  return (
    <Providers>
      <AppWithPwaInstall />
    </Providers>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: theme.colors.paper,
  },
  tabBarChrome: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  safeAreaTopFill: {
    ...(Platform.OS === "web" ? ({ height: "env(safe-area-inset-top, 0px)" } as any) : {}),
    backgroundColor: theme.colors.card,
  },
  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: theme.colors.card,
  },
  syncBanner: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  syncBannerText: {
    fontSize: 13,
    fontWeight: "700",
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
  },
  tabCompact: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tabActive: {
    backgroundColor: theme.colors.accent,
  },
  tabLabel: {
    color: theme.colors.accent,
    fontWeight: "700",
  },
  tabLabelCompact: {
    fontSize: 14,
  },
  tabLabelActive: {
    color: "#FFFFFF",
  },
  content: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.paper,
    gap: 10,
  },
  splashMark: {
    alignItems: "center",
    borderRadius: 28,
    height: 76,
    justifyContent: "center",
    marginBottom: 6,
    width: 76,
  },
  splashMarkText: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: "800",
  },
  loadingText: {
    color: theme.colors.muted,
    fontSize: 15,
    fontWeight: "600",
  },
});
