const APP_STORAGE_PREFIX = "spending-tracker-";
const PWA_HANDOFF_KEY = "spending-tracker-pwa-handoff";
const PWA_HANDOFF_APPLIED_KEY = "spending-tracker-pwa-handoff-applied";
const PWA_HANDOFF_REQUEST_TIMEOUT_MS = 1_500;
const PWA_HANDOFF_COOKIE_PREFIX = "spending-tracker-pwa-handoff-";
const PWA_HANDOFF_COOKIE_COUNT_KEY = `${PWA_HANDOFF_COOKIE_PREFIX}count`;
const PWA_HANDOFF_COOKIE_MAX_AGE = 600;
const PWA_HANDOFF_COOKIE_CHUNK_SIZE = 3_000;
const PWA_HANDOFF_COOKIE_MAX_CHUNKS = 24;

let pwaStoragePrepared: Promise<void> | null = null;
let pwaHandoffResponderInstalled = false;

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

function readCurrentStorageHandoff(): PwaStorageHandoff {
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

  return { version: 2, savedAt: new Date().toISOString(), data };
}

function encodeCookiePayload(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192));
  }
  return btoa(binary);
}

function decodeCookiePayload(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getCookie(name: string) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : null;
}

function clearPwaHandoffCookies() {
  const cookieOptions = "Max-Age=0; Path=/; SameSite=Lax";
  document.cookie = `${PWA_HANDOFF_COOKIE_COUNT_KEY}=; ${cookieOptions}`;
  for (let index = 0; index < PWA_HANDOFF_COOKIE_MAX_CHUNKS; index += 1) {
    document.cookie = `${PWA_HANDOFF_COOKIE_PREFIX}${index}=; ${cookieOptions}`;
  }
}

function readPwaHandoffCookie() {
  const count = Number(getCookie(PWA_HANDOFF_COOKIE_COUNT_KEY));
  if (!Number.isInteger(count) || count < 1 || count > PWA_HANDOFF_COOKIE_MAX_CHUNKS) {
    return null;
  }

  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = getCookie(`${PWA_HANDOFF_COOKIE_PREFIX}${index}`);
    if (!chunk) {
      return null;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(decodeCookiePayload(chunks.join(""))) as PwaStorageHandoff;
  } catch {
    return null;
  }
}

function writePwaHandoffCookie(handoff: PwaStorageHandoff) {
  const serialized = encodeCookiePayload(JSON.stringify(handoff));
  const chunks = serialized.match(new RegExp(`.{1,${PWA_HANDOFF_COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
  if (chunks.length > PWA_HANDOFF_COOKIE_MAX_CHUNKS) {
    return;
  }

  clearPwaHandoffCookies();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const cookieOptions = `Max-Age=${PWA_HANDOFF_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  chunks.forEach((chunk, index) => {
    document.cookie = `${PWA_HANDOFF_COOKIE_PREFIX}${index}=${chunk}; ${cookieOptions}`;
  });
  document.cookie = `${PWA_HANDOFF_COOKIE_COUNT_KEY}=${chunks.length}; ${cookieOptions}`;
}

function applyStorageHandoff(handoff: PwaStorageHandoff | null) {
  if (!handoff?.savedAt) {
    return;
  }

  const appliedAt = window.localStorage.getItem(PWA_HANDOFF_APPLIED_KEY) ?? "";
  if (handoff.savedAt <= appliedAt) {
    return;
  }

  for (const [key, value] of Object.entries(handoff.data ?? {})) {
    if (!key.startsWith(APP_STORAGE_PREFIX) || key === PWA_HANDOFF_KEY || key === PWA_HANDOFF_APPLIED_KEY) {
      continue;
    }
    window.localStorage.setItem(key, value);
  }
  window.localStorage.setItem(PWA_HANDOFF_APPLIED_KEY, handoff.savedAt);
}

function installPwaHandoffResponder() {
  if (pwaHandoffResponderInstalled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  pwaHandoffResponderInstalled = true;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      type?: string;
      requestId?: string;
      targetClientId?: string;
    } | null;
    if (message?.type !== "PWA_HANDOFF_REQUEST" || !message.requestId || !message.targetClientId) {
      return;
    }

    const response = {
      type: "PWA_HANDOFF_RESPONSE",
      requestId: message.requestId,
      targetClientId: message.targetClientId,
      handoff: readCurrentStorageHandoff(),
    };
    const serviceWorker = event.source as ServiceWorker | null;
    if (serviceWorker) {
      serviceWorker.postMessage(response);
    } else {
      navigator.serviceWorker.controller?.postMessage(response);
    }
  });
}

async function requestPwaStorageHandoff() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const requestId = `pwa-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise<PwaStorageHandoff | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => finish(null), PWA_HANDOFF_REQUEST_TIMEOUT_MS);

    const finish = (handoff: PwaStorageHandoff | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      resolve(handoff);
    };

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        requestId?: string;
        handoff?: PwaStorageHandoff;
      } | null;
      if (message?.type === "PWA_HANDOFF_RESPONSE" && message.requestId === requestId) {
        finish(message.handoff ?? null);
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    void navigator.serviceWorker.ready
      .then((registration) => {
        if (settled) {
          return;
        }
        const worker = navigator.serviceWorker.controller ?? registration.active ?? registration.waiting;
        if (!worker) {
          finish(null);
          return;
        }
        worker.postMessage({ type: "PWA_HANDOFF_REQUEST", requestId });
      })
      .catch(() => finish(null));
  });
}

/**
 * Some browsers expose the installed PWA as a separate storage container.
 * Keep a small, same-origin handoff snapshot so the installed app can restore
 * the app's persisted state before Zustand rehydrates.
 */
export function preparePwaStorage() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (pwaStoragePrepared) {
    return pwaStoragePrepared;
  }

  pwaStoragePrepared = (async () => {
    installPwaHandoffResponder();
    if (!isStandalonePwa()) {
      return;
    }

    try {
      applyStorageHandoff(readPwaHandoffCookie());
      clearPwaHandoffCookies();

      const rawHandoff = window.localStorage.getItem(PWA_HANDOFF_KEY);
      if (rawHandoff) {
        applyStorageHandoff(JSON.parse(rawHandoff) as PwaStorageHandoff);
      }

      const remoteHandoff = await requestPwaStorageHandoff();
      applyStorageHandoff(remoteHandoff);
    } catch {
      // Storage or service-worker messaging can be unavailable in restricted webviews.
    }
  })();

  return pwaStoragePrepared;
}

export function capturePwaStorageHandoff() {
  if (typeof window === "undefined") {
    return;
  }

  void preparePwaStorage();

  try {
    const handoff = readCurrentStorageHandoff();
    window.localStorage.setItem(PWA_HANDOFF_KEY, JSON.stringify(handoff));
    if (!isStandalonePwa()) {
      writePwaHandoffCookie(handoff);
    }
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
    return preparePwaStorage().then(() => window.localStorage.getItem(name));
  },
  setItem(name: string, value: string) {
    if (typeof window !== "undefined") {
      return preparePwaStorage().then(() => window.localStorage.setItem(name, value));
    }
    return Promise.resolve();
  },
  removeItem(name: string) {
    if (typeof window !== "undefined") {
      return preparePwaStorage().then(() => window.localStorage.removeItem(name));
    }
    return Promise.resolve();
  },
};
