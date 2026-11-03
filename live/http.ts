import { createServer } from "node:http";
import type { LiveHub } from "./hub";
import { parseLiveScope } from "../utils/live-scope";

/** Route/viewport-scoped SSE. No unrestricted fleet endpoint. */
export function createLiveServer(
  hub: LiveHub,
  options: {
    enabled: boolean;
    allowedOrigin?: string;
    intervalMs?: number;
    heartbeatMs?: number;
    maxClients?: number;
  },
) {
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && options.allowedOrigin && origin !== options.allowedOrigin) {
      res.writeHead(403).end("Origin not allowed");
      return;
    }
    if (origin && options.allowedOrigin === origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400).end("Invalid URL");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    if (url.pathname === "/live/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          enabled: options.enabled,
          clients: hub.clientCount,
        }),
      );
      return;
    }
    if (url.pathname !== "/live/vehicles") {
      res.writeHead(404).end();
      return;
    }
    if (!options.enabled) {
      res.writeHead(503).end("Experimental live service disabled");
      return;
    }
    const scope = parseLiveScope(
      url.searchParams,
      new Set(hub.routes.values()),
    );
    if (!scope) {
      res
        .writeHead(400)
        .end("A known GTFS route or valid viewport is required");
      return;
    }
    if (hub.clientCount >= (options.maxClients ?? 200)) {
      res.writeHead(503, { "Retry-After": "30" }).end("Viewer limit");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const release = hub.acquire();
    let closed = false,
      blockedAt = 0;
    const write = (frame: string) => {
      if (closed) return;
      if (
        res.writableLength > 256 * 1024 ||
        (blockedAt && Date.now() - blockedAt > 15_000)
      ) {
        res.destroy();
        return;
      }
      if (blockedAt) return; // Never build an unbounded queue for a slow viewer.
      if (!res.write(frame)) blockedAt = Date.now();
    };
    res.on("drain", () => {
      blockedAt = 0;
    });
    const send = () =>
      write(
        `event: snapshot\ndata: ${JSON.stringify(hub.snapshot(scope))}\n\n`,
      );
    send();
    const ticker = setInterval(send, options.intervalMs ?? 1000);
    const heartbeat = setInterval(
      () => write(": heartbeat\n\n"),
      options.heartbeatMs ?? 15_000,
    );
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ticker);
      clearInterval(heartbeat);
      release();
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
