const CACHE_NAME = "spending-tracker-shell-v12";
const APP_SHELL = ["./", "./offline.html", "./manifest.webmanifest?v=12", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
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
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("./offline.html")) || (await caches.match("./"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
