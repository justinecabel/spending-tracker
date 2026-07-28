import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { nanoid } from "nanoid";
import { WebSocket } from "ws";
import { authenticateOrCreateDeviceUserWithName, createSession } from "../src/auth";
import { config } from "../src/config";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { createRealtimeServer } from "../src/realtime";

test("WebSocket admission enforces the per-user connection cap", async () => {
  runMigrations();
  const originalMaxPerUser = config.websocketMaxPerUser;
  config.websocketMaxPerUser = 2;
  const user = authenticateOrCreateDeviceUserWithName(
    `websocket-device-${nanoid()}`,
    "w".repeat(43),
  );
  const session = createSession(user);
  const server = createRealtimeServer(express());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/ws?token=${encodeURIComponent(session.accessToken)}`;
  const sockets: WebSocket[] = [];

  try {
    sockets.push(await openSocket(url));
    sockets.push(await openSocket(url));
    const status = await rejectedUpgradeStatus(url);
    assert.equal(status, 429);
  } finally {
    config.websocketMaxPerUser = originalMaxPerUser;
    for (const socket of sockets) {
      socket.terminate();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM categories WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  }
});

function openSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function rejectedUpgradeStatus(url: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode);
      response.resume();
    });
    socket.once("open", () => {
      socket.terminate();
      reject(new Error("Expected the WebSocket upgrade to be rejected"));
    });
    socket.once("error", () => {
      // The unexpected-response event carries the status used by this check.
    });
  });
}
