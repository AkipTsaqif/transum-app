/** Bake only the validated operating Bandung networks. npm run sync:bandung.
 * OSM supplies routes, geometry and stop positions, never schedules. */
import fs from "node:fs/promises";
import path from "node:path";
import {
  BANDUNG_SYSTEMS,
  bakeBandung,
  type BandungSystem,
} from "../utils/bandung-data";
import type { OsmDocument } from "../utils/rail-geometry";

async function fetchRelation(id: number): Promise<OsmDocument> {
  const url = `https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "transum-app/0.1 (+https://github.com/AkipTsaqif/transum-app) bandung-sync",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(70_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as OsmDocument;
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
    }
  }
  throw new Error(`Relation ${id} unavailable`);
}

async function writeDataset(
  mode: BandungSystem,
  files: Record<string, unknown>,
) {
  const output = path.join(process.cwd(), "data", mode);
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
  // Stage and validate all three systems before replacing any published data.
  const staged = [];
  for (const mode of Object.keys(BANDUNG_SYSTEMS) as BandungSystem[]) {
    const lines = BANDUNG_SYSTEMS[mode];
    const relations = lines.flatMap((line) => line.relations);
    console.log(`Fetching ${mode}: ${relations.length} OSM relations`);
    const documents: OsmDocument[] = [];
    for (const id of relations) documents.push(await fetchRelation(id));
    const baked = bakeBandung(documents, lines);
    const files: Record<string, unknown> = {
      "routes.json": baked.routes,
      "stops.json": baked.stations,
      "stops-geo.json": baked.stopLayer,
      "overview.json": baked.overview,
      ".meta.json": {
        source: "OpenStreetMap relation full API",
        attribution: "© OpenStreetMap contributors",
        mode,
        relations,
        syncedAt: new Date().toISOString(),
        scope:
          "Validated operating Bandung rail, Metro Jabar Trans, Trans Metro Bandung, Bus Kota DAMRI and angkot trayek from OpenStreetMap; no timetable or headway data.",
        ...(mode === "bdg-angkot"
          ? {
              validation:
                "Every relation must pass bakeBandung: two or more named stops, one continuous way chain, stops on that chain in travel order. Mapped angkot relations that fail these checks are omitted rather than drawn approximately.",
            }
          : {}),
      },
    };
    for (const detail of baked.details)
      files[`routes/${encodeURIComponent(detail.route_id)}.json`] = detail;
    staged.push({ mode, files, baked });
  }
  for (const { mode, files, baked } of staged) {
    await writeDataset(mode, files);
    console.log(
      `${mode}: ${baked.routes.length} routes, ${baked.stations.length} stops`,
    );
  }
}
main().catch((error) => {
  console.error("Bandung sync failed:", error);
  process.exitCode = 1;
});
