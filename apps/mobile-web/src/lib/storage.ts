const APP_STORAGE_PREFIX = "spending-tracker-";
const PWA_HANDOFF_KEY = "spending-tracker-pwa-handoff";

let pwaStoragePrepared = false;

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

    const handoff = JSON.parse(rawHandoff) as { data?: Record<string, string> };
    for (const [key, value] of Object.entries(handoff.data ?? {})) {
      if (!key.startsWith(APP_STORAGE_PREFIX) || key === PWA_HANDOFF_KEY || window.localStorage.getItem(key) !== null) {
        continue;
      }
      window.localStorage.setItem(key, value);
    }
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
      if (key?.startsWith(APP_STORAGE_PREFIX) && key !== PWA_HANDOFF_KEY) {
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
