import type { NotificationTestResult } from "@spending-tracker/shared";

type NavigatorWithDiagnostics = Navigator & {
  deviceMemory?: number;
  standalone?: boolean;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
    type?: string;
  };
  userAgentData?: {
    mobile?: boolean;
    platform?: string;
    brands?: Array<{ brand: string; version: string }>;
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
  };
};

function storageAvailable(storage: Storage | undefined) {
  if (!storage) return false;
  try {
    const key = "__spending_tracker_diagnostic__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export async function collectClientDiagnostics() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { capturedAt: new Date().toISOString(), runtime: "native-or-server" };
  }

  const nav = navigator as NavigatorWithDiagnostics;
  const displayModes = ["standalone", "fullscreen", "minimal-ui", "browser"]
    .filter((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches);
  const connection = nav.connection;
  const orientation = window.screen?.orientation;
  const registration = "serviceWorker" in navigator
    ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
    : undefined;
  const storageEstimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const storagePersisted = await navigator.storage?.persisted?.().catch(() => undefined);
  const clientHints = nav.userAgentData?.getHighEntropyValues
    ? await nav.userAgentData.getHighEntropyValues([
        "architecture", "bitness", "formFactors", "fullVersionList", "model", "platformVersion", "uaFullVersion", "wow64",
      ]).catch(() => null)
    : null;

  return {
    capturedAt: new Date().toISOString(),
    page: {
      origin: window.location.origin,
      pathname: window.location.pathname,
      hashRoute: window.location.hash,
      secureContext: window.isSecureContext,
      visibilityState: document.visibilityState,
    },
    pwa: {
      displayModes,
      iosStandalone: Boolean(nav.standalone),
      likelyInstalled: Boolean(nav.standalone || displayModes.some((mode) => mode !== "browser")),
    },
    browser: {
      userAgent: nav.userAgent,
      vendor: nav.vendor,
      appVersion: nav.appVersion,
      platform: nav.platform,
      language: nav.language,
      languages: nav.languages ? [...nav.languages] : [],
      cookiesEnabled: nav.cookieEnabled,
      doNotTrack: nav.doNotTrack,
      online: nav.onLine,
      clientHints: nav.userAgentData ? {
        mobile: nav.userAgentData.mobile,
        platform: nav.userAgentData.platform,
        brands: nav.userAgentData.brands,
        highEntropy: clientHints,
      } : null,
    },
    device: {
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
      deviceMemoryGiB: nav.deviceMemory ?? null,
      maxTouchPoints: nav.maxTouchPoints ?? null,
      screen: window.screen ? {
        width: window.screen.width,
        height: window.screen.height,
        availableWidth: window.screen.availWidth,
        availableHeight: window.screen.availHeight,
        colorDepth: window.screen.colorDepth,
        pixelDepth: window.screen.pixelDepth,
        orientation: orientation ? { type: orientation.type, angle: orientation.angle } : null,
      } : null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    },
    locale: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    },
    notifications: {
      supported: "Notification" in window,
      permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    },
    serviceWorker: {
      supported: "serviceWorker" in navigator,
      controlled: Boolean(navigator.serviceWorker?.controller),
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
      registrationScope: registration?.scope ?? null,
      activeState: registration?.active?.state ?? null,
      pushSupported: Boolean(registration && "pushManager" in registration),
    },
    storage: {
      localStorage: storageAvailable(window.localStorage),
      sessionStorage: storageAvailable(window.sessionStorage),
      quotaBytes: storageEstimate?.quota ?? null,
      usageBytes: storageEstimate?.usage ?? null,
      persisted: storagePersisted ?? null,
    },
    connection: connection ? {
      effectiveType: connection.effectiveType ?? null,
      type: connection.type ?? null,
      downlinkMbps: connection.downlink ?? null,
      rttMs: connection.rtt ?? null,
      saveData: connection.saveData ?? null,
    } : null,
    capabilities: {
      touch: "ontouchstart" in window || nav.maxTouchPoints > 0,
      webShare: typeof nav.share === "function",
      badging: "setAppBadge" in navigator,
      installPromptApi: "BeforeInstallPromptEvent" in window,
    },
  };
}

export async function runNotificationDiagnostic(): Promise<NotificationTestResult> {
  const permissionBefore = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  if (typeof Notification === "undefined") {
    return { attempted: false, permissionBefore, permissionAfter: permissionBefore, deliveryMethod: "none", error: "Notifications are not supported." };
  }

  try {
    const permissionAfter = permissionBefore === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permissionAfter !== "granted") {
      return { attempted: true, permissionBefore, permissionAfter, deliveryMethod: "none", error: `Notification permission is ${permissionAfter}.` };
    }

    const registration = "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
      : undefined;
    if (registration) {
      await registration.showNotification("Spending Tracker notification test", {
        body: "Notifications are working on this device.",
        tag: `diagnostic-${Date.now()}`,
      });
      return { attempted: true, permissionBefore, permissionAfter, deliveryMethod: "service-worker", error: null };
    }

    new Notification("Spending Tracker notification test", {
      body: "Notifications are working on this device.",
    });
    return { attempted: true, permissionBefore, permissionAfter, deliveryMethod: "notification-constructor", error: null };
  } catch (error) {
    return {
      attempted: true,
      permissionBefore,
      permissionAfter: Notification.permission,
      deliveryMethod: "none",
      error: error instanceof Error ? error.message.slice(0, 500) : "Notification test failed.",
    };
  }
}
