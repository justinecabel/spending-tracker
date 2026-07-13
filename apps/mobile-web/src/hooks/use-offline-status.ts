import { useEffect, useRef, useState } from "react";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [hasCachedShell, setHasCachedShell] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const hasReloadedForController = useRef(false);

  const applyUpdate = () => {
    const waitingWorker = registrationRef.current?.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    const updateNetworkState = () => setIsOnline(navigator.onLine);
    const handleControllerChange = () => {
      if (!hasReloadedForController.current) {
        hasReloadedForController.current = true;
        window.location.reload();
      }
    };

    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);

    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker
        .register(new URL("sw.js", document.baseURI).toString(), { scope: new URL("./", document.baseURI).pathname })
        .then((registration) => {
          registrationRef.current = registration;
          setHasCachedShell(true);

          const watchInstallingWorker = () => {
            const installingWorker = registration.installing;
            if (!installingWorker) {
              return;
            }

            installingWorker.addEventListener("statechange", () => {
              if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          };

          registration.addEventListener("updatefound", watchInstallingWorker);
          if (registration.waiting && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        })
        .catch(() => setHasCachedShell(false));
    }

    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  return { isOnline, hasCachedShell, updateAvailable, applyUpdate };
}
