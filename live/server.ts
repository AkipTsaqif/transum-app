import fs from "node:fs/promises";
import path from "node:path";
import { LiveHub } from "./hub";
import { createLiveServer } from "./http";
import { connectTransjakarta } from "./mqtt-subscriber";

async function main() {
  const rows = JSON.parse(
    await fs.readFile(
      path.join(process.cwd(), "data/gtfs/routes.json"),
      "utf8",
    ),
  ) as { route_id: string; route_short_name: string; route_color: string }[];
  const routes = new Map<string, string>();
  for (const row of rows) {
    routes.set(row.route_id, row.route_id);
    if (!routes.has(row.route_short_name))
      routes.set(row.route_short_name, row.route_id);
  }
  const styles = new Map(
    rows.map((r) => [
      r.route_id,
      { shortName: r.route_short_name, color: r.route_color },
    ]),
  );
  const hub = new LiveHub(routes, connectTransjakarta, { styles });
  const enabled = process.env.TJ_LIVE_ENABLED === "true";
  const server = createLiveServer(hub, {
    enabled,
    allowedOrigin: process.env.TJ_LIVE_ALLOWED_ORIGIN,
  });
  const port = Number(process.env.TJ_LIVE_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid TJ_LIVE_PORT");
  server.listen(port, "127.0.0.1", () =>
    console.log(JSON.stringify({ event: "live_listening", port, enabled })),
  );
  const shutdown = () => {
    hub.stop();
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 250).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
void main().catch((err) => {
  console.error(
    "Live sidecar failed:",
    err instanceof Error ? err.message : "unknown",
  );
  process.exitCode = 1;
});
