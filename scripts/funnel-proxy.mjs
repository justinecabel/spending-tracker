import http from "node:http";
import net from "node:net";

const listenPort = Number(process.env.FUNNEL_PROXY_PORT ?? 8082);
const webTarget = { hostname: "127.0.0.1", port: Number(process.env.WEB_PORT ?? 8081) };
const apiTarget = { hostname: "127.0.0.1", port: Number(process.env.API_PORT ?? 4000) };

function apiRequestPath(url) {
  if (url === "/api") {
    return "/";
  }
  return url.replace(/^\/api(?=\/|$)/, "") || "/";
}

function targetFor(url) {
  return url === "/ws" || url.startsWith("/api/") || url === "/api" ? apiTarget : webTarget;
}

const proxy = http.createServer((request, response) => {
  const incomingUrl = request.url ?? "/";
  const target = targetFor(incomingUrl);
  const upstream = http.request(
    {
      ...target,
      method: request.method,
      path: target === apiTarget ? apiRequestPath(incomingUrl) : incomingUrl,
      headers: {
        ...request.headers,
        host: `${target.hostname}:${target.port}`,
        "x-forwarded-proto": "https",
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "application/json" });
    }
    response.end(JSON.stringify({ message: "Upstream service is unavailable" }));
  });

  request.pipe(upstream);
});

proxy.on("upgrade", (request, socket, head) => {
  const incomingUrl = request.url ?? "/";
  const target = targetFor(incomingUrl);
  const upstream = net.connect(target.port, target.hostname, () => {
    const headers = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\r\n");
    const path = target === apiTarget ? apiRequestPath(incomingUrl) : incomingUrl;
    upstream.write(`${request.method} ${path} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => socket.destroy());
});

proxy.listen(listenPort, "127.0.0.1", () => {
  console.log(`Funnel proxy listening on http://127.0.0.1:${listenPort}`);
});
