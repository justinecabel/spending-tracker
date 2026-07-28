import { createServer, type Server as HttpServer } from "node:http";
import type { Express } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyAccessToken } from "./auth";

type LiveUpdateMessage = {
  type: "connected" | "invalidate";
  keys?: string[];
  at: string;
};

const socketsByUser = new Map<string, Set<WebSocket>>();

export function createRealtimeServer(app: Express) {
  const server = createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });

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
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        attachSocket(websocketServer, websocket, user.id);
      });
    } catch {
      socket.destroy();
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
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

function attachSocket(websocketServer: WebSocketServer, websocket: WebSocket, userId: string) {
  const sockets = socketsByUser.get(userId) ?? new Set<WebSocket>();
  sockets.add(websocket);
  socketsByUser.set(userId, sockets);

  websocket.send(
    JSON.stringify({
      type: "connected",
      at: new Date().toISOString(),
    } satisfies LiveUpdateMessage),
  );

  websocket.on("close", () => {
    const current = socketsByUser.get(userId);
    current?.delete(websocket);
    if (!current?.size) {
      socketsByUser.delete(userId);
    }
  });

  websocket.on("error", () => {
    websocket.close();
  });
}

export type RealtimeHttpServer = HttpServer;
