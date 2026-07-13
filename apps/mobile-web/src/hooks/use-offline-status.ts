import { useEffect, useState } from "react";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [hasCachedShell, setHasCachedShell] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    const updateNetworkState = () => setIsOnline(navigator.onLine);
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);

    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker
        .register(new URL("sw.js", document.baseURI).toString(), { scope: new URL("./", document.baseURI).pathname })
        .then(() => setHasCachedShell(true))
        .catch(() => setHasCachedShell(false));
    }

    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  return { isOnline, hasCachedShell };
}
