
export type AppearanceMode = "device" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

type ThemePalette = {
  ink: string;
  paper: string;
  card: string;
  field: string;
  accent: string;
  accentSoft: string;
  warning: string;
  border: string;
  muted: string;
  success: string;
};

export const lightPalette: ThemePalette = {
  ink: "#1B1D1F",
  paper: "#F7F3EA",
  card: "#FFFDF8",
  field: "#FFFFFF",
  accent: "#0F766E",
  accentSoft: "#D9F3EF",
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

export function getPalette(scheme: ResolvedAppearance): ThemePalette {
  return scheme === "dark" ? darkPalette : lightPalette;
}

export function applyThemeMode(mode: AppearanceMode, deviceScheme?: "light" | "dark" | null) {
  if (typeof document === "undefined") {
    return;
  }

  const resolved = resolveAppearance(mode, deviceScheme);
  const palette = getPalette(resolved);
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

const webColors: ThemePalette = {
  ink: cssColorToken("ink"),
  paper: cssColorToken("paper"),
  card: cssColorToken("card"),
  field: cssColorToken("field"),
  accent: cssColorToken("accent"),
  accentSoft: cssColorToken("accentSoft"),
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
    elevation: 5,
    shadowColor: "rgba(0,0,0,0.08)",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
};
