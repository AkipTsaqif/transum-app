import fs from "node:fs/promises";
import path from "node:path";
import { LiveHub } from "./hub";
import { createLiveServer } from "./http";
import { connectTransjakarta } from "./mqtt-subscriber";
import { loadLiveEnv } from "./env";
import { liveConfig } from "./config";

async function main() {
  const envFiles = loadLiveEnv();
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
  // Validated before listening: a missing origin would otherwise accept every
  // site, and a trailing-slash origin would 403 for reasons the log hides.
  const { enabled, allowedOrigin, host, port } = liveConfig(process.env);
  const server = createLiveServer(hub, { enabled, allowedOrigin });
  server.listen(port, host, () =>
    console.log(
      JSON.stringify({
        event: "live_listening",
        port,
        host,
        enabled,
        allowedOrigin: allowedOrigin ?? null,
        envFiles,
      }),
    ),
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
