import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { verifyAccessToken } from "./auth";
const socketsByUser = new Map();
export function createRealtimeServer(app) {
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
        }
        catch {
            socket.destroy();
        }
    });
    return server;
}
export function notifyUser(userId, keys) {
    const sockets = socketsByUser.get(userId);
    if (!sockets?.size) {
        return;
    }
    const payload = JSON.stringify({
        type: "invalidate",
        keys,
        at: new Date().toISOString(),
    });
    for (const socket of sockets) {
        if (socket.readyState === 1) {
            socket.send(payload);
        }
    }
}
function attachSocket(websocketServer, websocket, userId) {
    const sockets = socketsByUser.get(userId) ?? new Set();
    sockets.add(websocket);
    socketsByUser.set(userId, sockets);
    websocket.send(JSON.stringify({
        type: "connected",
        at: new Date().toISOString(),
    }));
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
