import { requestPersistentStorage, storage } from "./storage";

const DEVICE_STORAGE_KEY = "spending-tracker-device-id";
const DEVICE_SECRET_STORAGE_KEY = "spending-tracker-device-secret";

function makeDeviceId() {
  return `device-${globalThis.crypto.randomUUID()}`;
}

function makeDeviceSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getDeviceId() {
  return storage.getItem(DEVICE_STORAGE_KEY);
}

export async function ensureDeviceId() {
  // This is normally called from an explicit sign-in action, where browsers are
  // most likely to honor a persistence request. The request is best-effort;
  // the app still works if a browser declines it.
  void requestPersistentStorage();

  const existing = await getDeviceId();
  if (existing) {
    return existing;
  }

  const created = makeDeviceId();
  await storage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
}

export async function getDeviceSecret() {
  return storage.getItem(DEVICE_SECRET_STORAGE_KEY);
}

export async function ensureDeviceCredential() {
  const deviceId = await ensureDeviceId();
  const existingSecret = await getDeviceSecret();
  if (existingSecret) {
    return { deviceId, deviceSecret: existingSecret };
  }

  const deviceSecret = makeDeviceSecret();
  await storage.setItem(DEVICE_SECRET_STORAGE_KEY, deviceSecret);
  return { deviceId, deviceSecret };
}

export async function getLocalDeviceLabel() {
  if (typeof window !== "undefined") {
    const agent = window.navigator.userAgent;
    if (/Android/i.test(agent)) {
      return "Android device";
    }
    if (/iPhone/i.test(agent)) {
      return "iPhone";
    }
    if (/iPad/i.test(agent)) {
      return "iPad";
    }
    if (/Windows/i.test(agent)) {
      return "Windows device";
    }
    if (/Macintosh|Mac OS X/i.test(agent)) {
      return "Mac device";
    }
    if (/Linux/i.test(agent)) {
      return "Linux device";
    }
  }

  return "This device";
}
