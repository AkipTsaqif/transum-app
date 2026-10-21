/** Bake the operating MRT North–South line. Run npm run sync:mrt.
 * OSM track/stop geometry only; no invented timetable or unopened Phase 2. */
import fs from "node:fs/promises";
import path from "node:path";
import { bakeMrt, MRT_RELATIONS, type OsmMrtDocument } from "../utils/mrt-data";

async function fetchRelation(id: number): Promise<OsmMrtDocument> {
  const url = `https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "transum-app/0.1 (+https://github.com/AkipTsaqif/transum-app) mrt-sync",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as OsmMrtDocument;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`MRT relation ${id} unavailable`);
}

async function main() {
  console.log("-> Fetching both MRT Jakarta subway directions from OSM");
  const result = bakeMrt(await Promise.all(MRT_RELATIONS.map(fetchRelation)));
  const output = path.join(process.cwd(), "data", "mrt");
  const temporary = `${output}.tmp-${process.pid}`;
  const backup = `${output}.bak-${process.pid}`;
  const files: Record<string, unknown> = {
    "routes.json": result.routes,
    "routes/M.json": result.route,
    "stops.json": result.stations,
    "stops-geo.json": result.stopLayer,
    "overview.json": result.overview,
    ".meta.json": {
      source: "OpenStreetMap relation full API",
      attribution: "© OpenStreetMap contributors",
      relations: MRT_RELATIONS,
      syncedAt: new Date().toISOString(),
      scope:
        "Operating North–South line, Lebak Bulus–Bundaran HI, 13 stations. Phase 2 excluded.",
    },
  };
  await fs.mkdir(path.join(temporary, "routes"), { recursive: true });
  try {
    for (const [name, value] of Object.entries(files)) {
      await fs.writeFile(
        path.join(temporary, name),
        JSON.stringify(value, null, name === ".meta.json" ? 2 : undefined),
      );
    }
    const exists = await fs
      .access(output)
      .then(() => true)
      .catch(() => false);
    if (exists) await fs.rename(output, backup);
    try {
      await fs.rename(temporary, output);
    } catch (error) {
      if (exists) await fs.rename(backup, output);
      throw error;
    }
    if (exists) await fs.rm(backup, { recursive: true, force: true });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  console.log(
    `✓ Baked MRT M: ${result.stations.length} stations, ${result.route.variants.length} directions`,
  );
}

main().catch((error) => {
  console.error("✗ MRT sync failed:", error);
  process.exitCode = 1;
});
