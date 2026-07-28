const CACHE_PREFIX = "spending-tracker-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-v23`;
const STATIC_CACHE = `${CACHE_PREFIX}static-v23`;
const APP_URL = new URL("./", self.registration.scope).href;
const OFFLINE_URL = new URL("./offline.html", self.registration.scope).href;
const APP_SHELL = [APP_URL, OFFLINE_URL, new URL("./manifest.webmanifest?v=23", self.registration.scope).href, new URL("./icon-192.png", self.registration.scope).href, new URL("./icon-512.png", self.registration.scope).href];
const STATIC_DESTINATIONS = new Set(["font", "image", "manifest", "script", "style", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "PWA_HANDOFF_REQUEST") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients
          .filter((client) => client.id !== event.source?.id)
          .forEach((client) => {
            client.postMessage({
              type: "PWA_HANDOFF_REQUEST",
              requestId: event.data.requestId,
              targetClientId: event.source?.id,
            });
          });
      }),
    );
    return;
  }

  if (event.data?.type === "PWA_HANDOFF_RESPONSE") {
    event.waitUntil(
      self.clients.get(event.data.targetClientId).then((client) => {
        client?.postMessage({
          type: "PWA_HANDOFF_RESPONSE",
          requestId: event.data.requestId,
          handoff: event.data.handoff,
        });
      }),
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== STATIC_CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.registration.navigationPreload?.enable(),
    ]).then(() => self.clients.claim()),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./#/debts", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = (await event.preloadResponse) || (await fetch(request));
          if (response.ok) {
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(APP_URL, response.clone())));
          }
          return response;
        } catch {
          return (await caches.match(APP_URL)) || (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Only cache static browser resources. Same-origin API responses may contain
  // profile data and must never be stored in the service worker cache.
  if (!STATIC_DESTINATIONS.has(request.destination)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone())));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })(),
  );
});
