import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const publicAsset = (name: string) => new URL(`../public/${name}`, import.meta.url);

describe("PWA assets", () => {
  it("declares the required installability metadata and app shortcuts", () => {
    const manifest = JSON.parse(readFileSync(publicAsset("manifest.webmanifest"), "utf8"));

    expect(manifest.name).toBe("Spending Tracker");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe("./#/home");
    expect(manifest.scope).toBe("./");
    expect(manifest.display).toBe("standalone");
    expect(manifest.prefer_related_applications).toBe(false);
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
    expect(manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url)).toEqual([
      "./#/transactions",
      "./#/reports",
    ]);
  });

  it("limits runtime caching to static browser resources", () => {
    const serviceWorker = readFileSync(publicAsset("sw.js"), "utf8");

    expect(serviceWorker).toContain("STATIC_DESTINATIONS.has(request.destination)");
    expect(serviceWorker).toContain("must never be stored in the service worker cache");
    expect(serviceWorker).toContain("navigationPreload");
    expect(serviceWorker).not.toContain("cache.put(request, copy)");
  });

  it("serves the cached app shell for failed navigations without intercepting API reads", async () => {
    const listeners = new Map<string, (event: any) => void>();
    const appUrl = "https://example.test/tracker/";
    const cachedShell = new Response("<!doctype html><title>Spending Tracker</title>");
    const caches = {
      keys: async () => [],
      open: async () => ({
        addAll: async () => undefined,
        put: async () => undefined,
      }),
      match: async (request: string | Request) => {
        const url = typeof request === "string" ? request : request.url;
        return url === appUrl ? cachedShell : undefined;
      },
    };
    const serviceWorker = readFileSync(publicAsset("sw.js"), "utf8");

    runInNewContext(serviceWorker, {
      caches,
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
      Promise,
      Response,
      Set,
      URL,
      self: {
        addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
        clients: {},
        location: new URL(appUrl),
        registration: {
          scope: appUrl,
          navigationPreload: { enable: async () => undefined },
        },
      },
    });

    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeTypeOf("function");

    let navigationResponse: Promise<Response> | undefined;
    fetchListener?.({
      request: {
        destination: "document",
        method: "GET",
        mode: "navigate",
        url: `${appUrl}#/settings`,
      },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (response: Promise<Response>) => {
        navigationResponse = response;
      },
      waitUntil: () => undefined,
    });

    expect(await navigationResponse).toBe(cachedShell);

    let apiWasIntercepted = false;
    fetchListener?.({
      request: {
        destination: "",
        method: "GET",
        mode: "cors",
        url: `${appUrl}api/transactions`,
      },
      respondWith: () => {
        apiWasIntercepted = true;
      },
      waitUntil: () => undefined,
    });

    expect(apiWasIntercepted).toBe(false);
  });

  it("provides a reconnect action on the offline fallback", () => {
    const offlinePage = readFileSync(publicAsset("offline.html"), "utf8");

    expect(offlinePage).toContain("Try again");
    expect(offlinePage).toContain('window.addEventListener("online"');
  });
});
