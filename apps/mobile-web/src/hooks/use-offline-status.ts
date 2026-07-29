import { useEffect, useRef, useState } from "react";

const BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? "development";
const BUILD_CHECK_INTERVAL_MS = 60_000;
// Metro development sessions do not have a deployable build identity. Checking
// their generated build-info file would therefore always look like an update.
const IS_PRODUCTION_BUILD = BUILD_ID !== "development";

type BuildInfo = { id?: string };

export function useOfflineStatus({ autoApplyWaitingUpdate = false }: { autoApplyWaitingUpdate?: boolean } = {}) {
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

    let cancelled = false;
    const checkForNewBuild = async () => {
      if (!navigator.onLine || cancelled) {
        return;
      }
      try {
        // The changing query string also avoids stale responses from an older
        // service worker that predates the build-info cache exclusion.
        const buildInfoUrl = new URL(`build-info.json?check=${Date.now()}`, document.baseURI);
        const response = await fetch(buildInfoUrl, { cache: "no-store" });
        const build = (await response.json()) as BuildInfo;
        if (!cancelled && build.id && build.id !== BUILD_ID) {
          setUpdateAvailable(true);
          void registrationRef.current?.update();
        }
      } catch {
        // Offline and captive-network responses should not show an update prompt.
      }
    };
    let buildCheckTimer: number | undefined;
    if (IS_PRODUCTION_BUILD) {
      void checkForNewBuild();
      buildCheckTimer = window.setInterval(() => void checkForNewBuild(), BUILD_CHECK_INTERVAL_MS);
    }

    if (IS_PRODUCTION_BUILD && "serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker
        .register(new URL("sw.js", document.baseURI).toString(), { scope: new URL("./", document.baseURI).pathname })
        .then((registration) => {
          registrationRef.current = registration;
          setHasCachedShell(true);

          const activateWaitingWorker = () => {
            registration.waiting?.postMessage({ type: "SKIP_WAITING" });
          };

          const watchInstallingWorker = () => {
            const installingWorker = registration.installing;
            if (!installingWorker) {
              return;
            }

            installingWorker.addEventListener("statechange", () => {
              if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                if (autoApplyWaitingUpdate) {
                  activateWaitingWorker();
                } else {
                  setUpdateAvailable(true);
                }
              }
            });
          };

          registration.addEventListener("updatefound", watchInstallingWorker);
          if (registration.waiting && navigator.serviceWorker.controller) {
            if (autoApplyWaitingUpdate) {
              activateWaitingWorker();
            } else {
              setUpdateAvailable(true);
            }
          }
        })
        .catch(() => setHasCachedShell(false));
    }

    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
      cancelled = true;
      if (buildCheckTimer !== undefined) {
        window.clearInterval(buildCheckTimer);
      }
    };
  }, [autoApplyWaitingUpdate]);

  return { isOnline, hasCachedShell, updateAvailable, applyUpdate };
}
