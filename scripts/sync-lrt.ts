/** Bake the operating LRT lines. Run npm run sync:lrt.
 *
 * Two systems, two modes, two datasets:
 *   data/lrt/   LRT Jakarta, line J (Jakarta government, via Jakpro)
 *   data/lrtj/  LRT Jabodebek, Cibubur + Bekasi (PT KAI)
 *
 * OSM track/stop geometry only; no invented timetable. */
import fs from "node:fs/promises";
import path from "node:path";
import {
  bakeLrt,
  LRT_LINES,
  LRT_SYSTEMS,
  lrtRelations,
  type LrtSystem,
  type OsmLrtDocument,
} from "../utils/lrt-data";

async function fetchRelation(id: number): Promise<OsmLrtDocument> {
  const url = `https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "transum-app/0.1 (+https://github.com/AkipTsaqif/transum-app) lrt-sync",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as OsmLrtDocument;
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`LRT relation ${id} unavailable`);
}

/** Stage every file, then swap the directory in one rename. */
async function writeDataset(dir: string, files: Record<string, unknown>) {
  const output = path.join(process.cwd(), "data", dir);
  const temporary = `${output}.tmp-${process.pid}`;
  const backup = `${output}.bak-${process.pid}`;
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
}

async function main() {
  const systems = Object.keys(LRT_SYSTEMS) as LrtSystem[];
  // Fetch and bake BOTH systems before writing either, so a failure on one
  // never leaves the two datasets out of step.
  const baked = [];
  for (const system of systems) {
    const config = LRT_SYSTEMS[system];
    console.log(`-> Fetching ${config.label} relations from OSM`);
    // Sequential, not Promise.all: parallel full-relation fetches trip the
    // public API's rate limiting, and this runs rarely.
    const documents: OsmLrtDocument[] = [];
    for (const id of lrtRelations(system)) {
      documents.push(await fetchRelation(id));
    }
    const lines = config.lines.map((id) => LRT_LINES[id]);
    baked.push({ system, result: bakeLrt(documents, lines, config.mode) });
  }

  for (const { system, result } of baked) {
    const config = LRT_SYSTEMS[system];
    const files: Record<string, unknown> = {
      "routes.json": result.routes,
      "stops.json": result.stations,
      "stops-geo.json": result.stopLayer,
      "overview.json": result.overview,
      ".meta.json": {
        source: "OpenStreetMap relation full API",
        attribution: "© OpenStreetMap contributors",
        system: config.label,
        relations: lrtRelations(system),
        syncedAt: new Date().toISOString(),
        scope: `Operating ${config.label} lines: ${result.routes
          .map((r) => `${r.route_id} ${r.route_long_name}`)
          .join(", ")}.`,
      },
    };
    for (const detail of result.details) {
      files[`routes/${encodeURIComponent(detail.route_id)}.json`] = detail;
    }
    await writeDataset(config.dir, files);
    console.log(
      `✓ Baked ${config.label} -> data/${config.dir}: ${result.details.length} line(s), ${result.stations.length} stations`,
    );
  }
}

main().catch((error) => {
  console.error("✗ LRT sync failed:", error);
  process.exitCode = 1;
});
