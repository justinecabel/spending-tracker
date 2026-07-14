
export type AppearanceMode = "device" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

type ThemePalette = {
  ink: string;
  paper: string;
  card: string;
  field: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  accentSoftText: string;
  warning: string;
  border: string;
  muted: string;
  success: string;
};

export function normalizeCustomAccent(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export const lightPalette: ThemePalette = {
  ink: "#1B1D1F",
  paper: "#F7F3EA",
  card: "#FFFDF8",
  field: "#FFFFFF",
  accent: "#0F766E",
  accentSoft: "#D9F3EF",
  accentText: "#FFFFFF",
  accentSoftText: "#0F766E",
  warning: "#C2410C",
  border: "#E7DFC9",
  muted: "#6B6B6B",
  success: "#166534",
};

export const darkPalette: ThemePalette = {
  ink: "#F4F0E7",
  paper: "#11161A",
  card: "#1A2126",
  field: "#141B20",
  accent: "#34D399",
  accentSoft: "#173F39",
  accentText: "#11161A",
  accentSoftText: "#F4F0E7",
  warning: "#FB923C",
  border: "#314048",
  muted: "#A8B1B8",
  success: "#4ADE80",
};

function cssColorToken(name: keyof ThemePalette) {
  return `var(--st-${name})`;
}

export function resolveAppearance(mode: AppearanceMode, deviceScheme?: "light" | "dark" | null): ResolvedAppearance {
  if (mode === "light" || mode === "dark") {
    return mode;
  }

  return deviceScheme === "dark" ? "dark" : "light";
}

export function getPalette(
  scheme: ResolvedAppearance,
  customAccent?: string | null,
  customSecondaryAccent?: string | null,
): ThemePalette {
  const basePalette = scheme === "dark" ? darkPalette : lightPalette;
  const accent = normalizeCustomAccent(customAccent);
  const accentSoft = normalizeCustomAccent(customSecondaryAccent);
  const resolvedAccent = accent ?? basePalette.accent;
  const resolvedAccentSoft = accentSoft ?? blendHex(resolvedAccent, basePalette.card, scheme === "dark" ? 0.24 : 0.14);
  return {
    ...basePalette,
    accent: resolvedAccent,
    accentSoft: resolvedAccentSoft,
    accentText: contrastText(resolvedAccent),
    accentSoftText: contrastText(resolvedAccentSoft),
  };
}

export function applyThemeMode(
  mode: AppearanceMode,
  deviceScheme?: "light" | "dark" | null,
  customAccent?: string | null,
  customSecondaryAccent?: string | null,
) {
  if (typeof document === "undefined") {
    return;
  }

  const resolved = resolveAppearance(mode, deviceScheme);
  const palette = getPalette(resolved, customAccent, customSecondaryAccent);
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.body.style.backgroundColor = palette.paper;
  document.body.style.color = palette.ink;

  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--st-${key}`, value);
  }

  let metaTheme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!metaTheme) {
    metaTheme = document.createElement("meta");
    metaTheme.name = "theme-color";
    document.head.appendChild(metaTheme);
  }
  metaTheme.content = palette.card;

  const appleStatusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (appleStatusBar) {
    // Keep the status bar translucent so the app shell's top surface owns the
    // safe-area background on both light and dark modes.
    appleStatusBar.setAttribute("content", "black-translucent");
  }
}

function blendHex(foreground: string, background: string, alpha: number) {
  const foregroundChannels = hexChannels(foreground);
  const backgroundChannels = hexChannels(background);
  const channels = foregroundChannels.map((channel, index) => Math.round(channel * alpha + backgroundChannels[index]! * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function contrastText(hex: string) {
  const [red, green, blue] = hexChannels(hex).map((channel) => channel / 255);
  const luminance = 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
  return luminance > 0.42 ? "#11161A" : "#FFFFFF";
}

function hexChannels(hex: string) {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((value) => Number.parseInt(value, 16));
}

function linearize(channel: number) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

const webColors: ThemePalette = {
  ink: cssColorToken("ink"),
  paper: cssColorToken("paper"),
  card: cssColorToken("card"),
  field: cssColorToken("field"),
  accent: cssColorToken("accent"),
  accentSoft: cssColorToken("accentSoft"),
  accentText: cssColorToken("accentText"),
  accentSoftText: cssColorToken("accentSoftText"),
  warning: cssColorToken("warning"),
  border: cssColorToken("border"),
  muted: cssColorToken("muted"),
  success: cssColorToken("success"),
};

export const theme = {
  colors: webColors,
  radius: {
    sm: 12,
    md: 18,
    lg: 28,
  },
  shadow: {
    boxShadow: "0px 8px 14px rgba(0, 0, 0, 0.08)",
  },
};
