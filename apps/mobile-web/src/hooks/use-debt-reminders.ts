import { useEffect } from "react";
import type { Debt } from "@spending-tracker/shared";
import { api } from "../lib/api";

const CHECK_INTERVAL_MS = 60_000;
const NOTIFIED_KEY = "spending-tracker-debt-reminders";

function readNotifiedKeys() {
  if (typeof localStorage === "undefined") return new Set<string>();
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function reminderKey(debt: Debt) {
  return `${debt.id}:${debt.dueAt}:${debt.reminderDaysBefore}`;
}

async function showDebtNotification(debt: Debt, currency: string) {
  const dueLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(debt.dueAt));
  const amount = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(debt.amount);
  const options: NotificationOptions = {
    body: `${amount} is due ${dueLabel}.`,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: `debt-${debt.id}`,
    data: { url: "./#/debts" },
  };

  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (registration) {
    await registration.showNotification(`Debt reminder: ${debt.merchant}`, options);
  } else {
    new Notification(`Debt reminder: ${debt.merchant}`, options);
  }
}

export async function checkDebtReminders(currency: string) {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  const debts = await api.debts();
  const notified = readNotifiedKeys();
  const now = Date.now();
  let changed = false;

  for (const debt of debts) {
    if (debt.paidAt || debt.reminderDaysBefore === null) continue;
    const remindAt = new Date(debt.dueAt).getTime() - debt.reminderDaysBefore * 86_400_000;
    const expiresAt = new Date(debt.dueAt).getTime() + 86_400_000;
    const key = reminderKey(debt);
    if (now < remindAt || now > expiresAt || notified.has(key)) continue;

    await showDebtNotification(debt, currency);
    notified.add(key);
    changed = true;
  }

  if (changed) {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified].slice(-200)));
  }
}

export function useDebtReminders(enabled: boolean, currency: string) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const check = () => void checkDebtReminders(currency).catch(() => undefined);
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [currency, enabled]);
}
