import { storage } from "./storage";

const DEVICE_STORAGE_KEY = "spending-tracker-device-id";

function makeDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getDeviceId() {
  return storage.getItem(DEVICE_STORAGE_KEY);
}

export async function ensureDeviceId() {
  const existing = await getDeviceId();
  if (existing) {
    return existing;
  }

  const created = makeDeviceId();
  await storage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
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
