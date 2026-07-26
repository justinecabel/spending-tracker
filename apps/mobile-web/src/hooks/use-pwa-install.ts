import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { capturePwaStorageHandoff, requestPersistentStorage } from "../lib/storage";

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
  manualInstallHint: string | null;
  install: () => Promise<boolean>;
};

type PwaTheme = {
  surface: string;
};

const unavailableInstall = async () => false;
export const PwaInstallContext = createContext<PwaInstallState>({
  canInstall: false,
  isInstalled: false,
  manualInstallHint: null,
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

export function usePwaInstall(pwaTheme: PwaTheme = { surface: "#FFFDF8" }) {
  const { surface } = pwaTheme;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [manualInstallHint, setManualInstallHint] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    ensureMetaTags(surface);
  }, [surface]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    capturePwaStorageHandoff();
    void requestPersistentStorage();
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const installed = Boolean(displayMode?.matches || window.navigator.standalone);
    setIsInstalled(installed);
    setManualInstallHint(installed ? null : getManualInstallHint(window.navigator));

    const onInstalled = () => {
      capturePwaStorageHandoff();
      void requestPersistentStorage();
      setIsInstalled(true);
      setManualInstallHint(null);
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

    if (typeof document !== "undefined") {
      ensureMetaTags(surface);
    }

    // Capture the current signed-in session, device ID, saved profiles, and
    // other app data immediately before the browser creates the PWA window.
    capturePwaStorageHandoff();
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setIsInstalled(true);
    }
    setInstallPrompt(null);
    return result.outcome === "accepted";
  }, [installPrompt, surface]);

  return {
    canInstall: Boolean(installPrompt) && !isInstalled,
    isInstalled,
    manualInstallHint: isInstalled || installPrompt ? null : manualInstallHint,
    install,
  };
}

function getManualInstallHint(navigatorValue: Navigator) {
  const isIos =
    /iPad|iPhone|iPod/i.test(navigatorValue.userAgent) ||
    (navigatorValue.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1);

  if (isIos) {
    return "Open the browser Share menu, then choose Add to Home Screen.";
  }

  return "Use your browser menu and choose Install app or Add to Home Screen.";
}

function ensureMetaTags(surface: string) {
  setMeta("theme-color", surface);
  setMeta("apple-mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  setMeta("apple-mobile-web-app-title", "Spending Tracker");
}

function setMeta(name: string, content: string) {
  let node = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement("meta");
    node.name = name;
    document.head.appendChild(node);
  }
  node.content = content;
}
