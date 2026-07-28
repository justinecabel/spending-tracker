import { createServer, type Server as HttpServer } from "node:http";
import type { Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { verifyAccessToken } from "./auth";
import { config } from "./config";

type LiveUpdateMessage = {
  type: "connected" | "invalidate";
  keys?: string[];
  at: string;
};

const socketsByUser = new Map<string, Set<WebSocket>>();
const socketLiveness = new WeakMap<WebSocket, boolean>();

export function createRealtimeServer(app: Express) {
  const server = createServer(app);
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1_024,
    perMessageDeflate: false,
  });
  const heartbeatTimer = setInterval(() => {
    for (const websocket of websocketServer.clients) {
      if (!socketLiveness.get(websocket)) {
        websocket.terminate();
        continue;
      }
      socketLiveness.set(websocket, false);
      websocket.ping();
    }
  }, config.websocketHeartbeatSeconds * 1_000);
  heartbeatTimer.unref();

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = requestUrl.searchParams.get("token");
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      const user = verifyAccessToken(token);
      const userSocketCount = socketsByUser.get(user.id)?.size ?? 0;
      if (
        userSocketCount >= config.websocketMaxPerUser ||
        websocketServer.clients.size >= config.websocketMaxTotal
      ) {
        socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        attachSocket(websocketServer, websocket, user.id);
      });
    } catch {
      socket.destroy();
    }
  });

  server.on("close", () => {
    clearInterval(heartbeatTimer);
    for (const websocket of websocketServer.clients) {
      websocket.terminate();
    }
  });

  return server;
}

export function notifyUser(userId: string, keys: string[]) {
  const sockets = socketsByUser.get(userId);
  if (!sockets?.size) {
    return;
  }

  const payload = JSON.stringify({
    type: "invalidate",
    keys,
    at: new Date().toISOString(),
  } satisfies LiveUpdateMessage);

  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    if (socket.bufferedAmount > config.websocketMaxBufferedBytes) {
      socket.terminate();
      continue;
    }
    socket.send(payload, (error) => {
      if (error) {
        socket.terminate();
      }
    });
  }
}

function attachSocket(websocketServer: WebSocketServer, websocket: WebSocket, userId: string) {
  const sockets = socketsByUser.get(userId) ?? new Set<WebSocket>();
  if (
    sockets.size >= config.websocketMaxPerUser ||
    websocketServer.clients.size > config.websocketMaxTotal
  ) {
    websocket.close(1013, "Connection limit reached");
    return;
  }

  sockets.add(websocket);
  socketsByUser.set(userId, sockets);
  socketLiveness.set(websocket, true);
  websocket.on("pong", () => {
    socketLiveness.set(websocket, true);
  });

  websocket.send(
    JSON.stringify({
      type: "connected",
      at: new Date().toISOString(),
    } satisfies LiveUpdateMessage),
  );

  const lifetimeTimer = setTimeout(
    () => websocket.close(1000, "Connection lifetime reached"),
    config.websocketMaxLifetimeHours * 60 * 60 * 1_000,
  );
  lifetimeTimer.unref();

  websocket.on("close", () => {
    clearTimeout(lifetimeTimer);
    const current = socketsByUser.get(userId);
    current?.delete(websocket);
    if (!current?.size) {
      socketsByUser.delete(userId);
    }
  });

  websocket.on("error", () => {
    websocket.terminate();
  });
}

export type RealtimeHttpServer = HttpServer;
