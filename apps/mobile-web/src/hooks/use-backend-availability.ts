import { useEffect, useState } from "react";
import { apiUrl } from "../lib/api";

type BackendStatus = "checking" | "available" | "unavailable";

/** Keeps the shell in a reconnecting state while the API host is reachable again. */
export function useBackendAvailability() {
  const [status, setStatus] = useState<BackendStatus>("checking");

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const check = async () => {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(`${apiUrl}/health`, { signal: controller.signal });
        if (active) {
          setStatus(response.ok ? "available" : "unavailable");
        }
      } catch {
        if (active) {
          setStatus("unavailable");
        }
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    };

    void check();
    interval = setInterval(() => void check(), 4_000);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return status;
}
