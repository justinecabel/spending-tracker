import { requestPersistentStorage, storage } from "./storage";

const DEVICE_STORAGE_KEY = "spending-tracker-device-id";
const DEVICE_SECRET_STORAGE_KEY = "spending-tracker-device-secret";

function makeDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function makeDeviceSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function getDeviceId() {
  return storage.getItem(DEVICE_STORAGE_KEY);
}

export async function ensureDeviceCredentials() {
  // This is normally called from an explicit sign-in action, where browsers are
  // most likely to honor a persistence request. The request is best-effort;
  // the app still works if a browser declines it.
  void requestPersistentStorage();

  let deviceId = await getDeviceId();
  if (!deviceId) {
    deviceId = makeDeviceId();
    await storage.setItem(DEVICE_STORAGE_KEY, deviceId);
  }

  let deviceSecret = await storage.getItem(DEVICE_SECRET_STORAGE_KEY);
  if (!deviceSecret) {
    deviceSecret = makeDeviceSecret();
    await storage.setItem(DEVICE_SECRET_STORAGE_KEY, deviceSecret);
  }

  return { deviceId, deviceSecret };
}

export async function ensureDeviceId() {
  return (await ensureDeviceCredentials()).deviceId;
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
