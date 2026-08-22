import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Font from "expo-font";
import { useEffect, useState, type ComponentProps } from "react";
import { appearanceStore, getAppearanceProfileKey } from "../state/appearance";
import { sessionStore } from "../state/session";

export type AppIconName =
  | "home"
  | "transactions"
  | "debts"
  | "reports"
  | "settings"
  | "add"
  | "save"
  | "retry"
  | "edit"
  | "delete"
  | "close"
  | "paid"
  | "reopen"
  | "viewReport"
  | "viewDebts"
  | "more"
  | "showMore"
  | "showLess"
  | "showIcons"
  | "hideIcons"
  | "notifications";

const iconByName: Record<AppIconName, ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  home: "home-outline",
  transactions: "receipt",
  debts: "cash-multiple",
  reports: "chart-line",
  settings: "cog-outline",
  add: "plus",
  save: "content-save-outline",
  retry: "refresh",
  edit: "pencil-outline",
  delete: "delete-outline",
  close: "close",
  paid: "check-circle-outline",
  reopen: "undo",
  viewReport: "chart-line",
  viewDebts: "wallet-outline",
  more: "dots-horizontal",
  showMore: "chevron-down",
  showLess: "chevron-up",
  showIcons: "eye-outline",
  hideIcons: "eye-off-outline",
  notifications: "bell-outline",
};

const iconFontFamily = "material-community";
const pagesBaseUrl = process.env.EXPO_PUBLIC_BASE_URL ?? "";
const iconFontSource = pagesBaseUrl
  ? `${pagesBaseUrl}/assets/material-community.ttf`
  : require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf");
let iconFontLoad: Promise<void> | null = null;

function loadIconFont() {
  iconFontLoad ??= Font.loadAsync({ [iconFontFamily]: iconFontSource });
  return iconFontLoad;
}

function useIconFontReady() {
  const [ready, setReady] = useState(() => Font.isLoaded(iconFontFamily));

  useEffect(() => {
    let active = true;
    void loadIconFont().then(() => {
      if (active) {
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return ready;
}

export function useShowIcons() {
  const activeProfile = sessionStore((state) => state.activeProfile);
  const userId = sessionStore((state) => state.user?.id);
  const profileKey = getAppearanceProfileKey(activeProfile, userId);

  return appearanceStore((state) => state.getShowIcons(profileKey));
}

export function AppIcon({ name, color, size = 18 }: { name: AppIconName; color: string; size?: number }) {
  const showIcons = useShowIcons();
  const iconFontReady = useIconFontReady();

  if (!showIcons || !iconFontReady) {
    return null;
  }

  return <MaterialCommunityIcons name={iconByName[name]} color={color} size={size} />;
}
