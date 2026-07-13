import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { darkPalette, lightPalette } from "../theme";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type PwaInstallState = {
  canInstall: boolean;
  isInstalled: boolean;
  install: () => Promise<boolean>;
};

const unavailableInstall = async () => false;
export const PwaInstallContext = createContext<PwaInstallState>({
  canInstall: false,
  isInstalled: false,
  install: unavailableInstall,
});

export function usePwaInstallContext() {
  return useContext(PwaInstallContext);
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    ensureManifest();
    ensureMetaTags();
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    setIsInstalled(Boolean(displayMode?.matches || window.navigator.standalone));

    const onInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onDisplayChange = (event: MediaQueryListEvent) => {
      setIsInstalled(event.matches);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode?.addEventListener?.("change", onDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode?.removeEventListener?.("change", onDisplayChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) {
      return false;
    }

    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setIsInstalled(true);
    }
    setInstallPrompt(null);
    return result.outcome === "accepted";
  }, [installPrompt]);

  return {
    canInstall: Boolean(installPrompt) && !isInstalled,
    isInstalled,
    install,
  };
}

function ensureManifest() {
  const manifestId = "spending-tracker-manifest";
  const iconUrl = new URL("spend-icon.svg?v=6", document.baseURI).toString();
  ensureAppIcons(iconUrl);
  if (document.getElementById(manifestId)) {
    return;
  }

  const link = document.createElement("link");
  link.id = manifestId;
  link.rel = "manifest";
  link.href = new URL("manifest.webmanifest?v=6", document.baseURI).toString();
  document.head.appendChild(link);
}

function buildAppIconUrl() {
  const iconSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="120" fill="${lightPalette.accent}" />
      <text x="256" y="320" text-anchor="middle" font-size="250">💸</text>
    </svg>
  `.trim());

  return `data:image/svg+xml,${iconSvg}`;
}

function ensureAppIcons(iconUrl: string) {
  for (const [id, rel] of [["spending-tracker-favicon", "icon"], ["spending-tracker-apple-icon", "apple-touch-icon"]] as const) {
    let icon = document.getElementById(id) as HTMLLinkElement | null;
    if (!icon) {
      icon = document.createElement("link");
      icon.id = id;
      icon.rel = rel;
      document.head.appendChild(icon);
    }
    icon.href = iconUrl;
  }
}

function ensureMetaTags() {
  setMeta("theme-color", currentWebPalette().card);
  setMeta("apple-mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  setMeta("apple-mobile-web-app-title", "Spend");
}

function currentWebPalette() {
  const selectedTheme = document.documentElement.dataset.theme;
  if (selectedTheme === "dark") {
    return darkPalette;
  }

  return lightPalette;
}

function setMeta(name: string, content: string) {
  const id = `meta-${name}`;
  let node = document.getElementById(id) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement("meta");
    node.id = id;
    node.name = name;
    document.head.appendChild(node);
  }
  node.content = content;
}
