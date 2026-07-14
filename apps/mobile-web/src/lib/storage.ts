const APP_STORAGE_PREFIX = "spending-tracker-";
const PWA_HANDOFF_KEY = "spending-tracker-pwa-handoff";
const PWA_HANDOFF_APPLIED_KEY = "spending-tracker-pwa-handoff-applied";

let pwaStoragePrepared = false;

type PwaStorageHandoff = {
  version?: number;
  savedAt?: string;
  data?: Record<string, string>;
};

function isStandalonePwa() {
  return Boolean(
    typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone),
  );
}

/**
 * Some browsers expose the installed PWA as a separate storage container.
 * Keep a small, same-origin handoff snapshot so the installed app can restore
 * the app's persisted state before Zustand rehydrates.
 */
export function preparePwaStorage() {
  if (pwaStoragePrepared || typeof window === "undefined") {
    return;
  }

  pwaStoragePrepared = true;

  try {
    const rawHandoff = window.localStorage.getItem(PWA_HANDOFF_KEY);
    if (!rawHandoff) {
      return;
    }

    if (!isStandalonePwa()) {
      return;
    }

    const handoff = JSON.parse(rawHandoff) as PwaStorageHandoff;
    const savedAt = handoff.savedAt ?? "";
    const appliedAt = window.localStorage.getItem(PWA_HANDOFF_APPLIED_KEY) ?? "";
    if (!savedAt || savedAt <= appliedAt) {
      return;
    }

    for (const [key, value] of Object.entries(handoff.data ?? {})) {
      if (!key.startsWith(APP_STORAGE_PREFIX) || key === PWA_HANDOFF_KEY || key === PWA_HANDOFF_APPLIED_KEY) {
        continue;
      }
      window.localStorage.setItem(key, value);
    }
    window.localStorage.setItem(PWA_HANDOFF_APPLIED_KEY, savedAt);
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}

export function capturePwaStorageHandoff() {
  if (typeof window === "undefined") {
    return;
  }

  preparePwaStorage();

  try {
    const data: Record<string, string> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(APP_STORAGE_PREFIX) && key !== PWA_HANDOFF_KEY && key !== PWA_HANDOFF_APPLIED_KEY) {
        const value = window.localStorage.getItem(key);
        if (value !== null) {
          data[key] = value;
        }
      }
    }

    window.localStorage.setItem(
      PWA_HANDOFF_KEY,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), data }),
    );
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}

export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export const storage = {
  getItem(name: string) {
    if (typeof window === "undefined") {
      return Promise.resolve(null);
    }
    preparePwaStorage();
    return Promise.resolve(window.localStorage.getItem(name));
  },
  setItem(name: string, value: string) {
    if (typeof window !== "undefined") {
      preparePwaStorage();
      window.localStorage.setItem(name, value);
    }
    return Promise.resolve();
  },
  removeItem(name: string) {
    if (typeof window !== "undefined") {
      preparePwaStorage();
      window.localStorage.removeItem(name);
    }
    return Promise.resolve();
  },
};
