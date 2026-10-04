import fs from "node:fs/promises";
import path from "node:path";
import type { RouteDetail, RouteSummary } from "@/utils/types/gtfs";

const DATA_DIR = path.join(process.cwd(), "data", "gtfs");

/**
 * Baked GTFS accessors.
 *
 * `data/gtfs/` is produced by `npm run sync:gtfs` from the official
 * Transjakarta feed. The files are static between syncs, so the index is
 * memoised per server process -- the disk is touched once, not per request.
 */

let indexCache: RouteSummary[] | null = null;

export async function getRouteIndex(): Promise<RouteSummary[]> {
    if (indexCache) return indexCache;

    const raw = await fs.readFile(path.join(DATA_DIR, "routes.json"), "utf-8");
    indexCache = JSON.parse(raw) as RouteSummary[];
    return indexCache;
}

/**
 * One route's geometry and stops. Returns null when the id is unknown so the
 * caller can answer 404 instead of leaking an ENOENT stack trace.
 *
 * `encodeURIComponent` mirrors the filename encoding used by the sync script,
 * and also prevents `..` traversal from reaching the filesystem.
 */
export async function getRouteDetail(
    routeId: string
): Promise<RouteDetail | null> {
    const file = path.join(DATA_DIR, "routes", `${encodeURIComponent(routeId)}.json`);

    // Defence in depth: the encoded name can never escape, but assert it anyway.
    if (!file.startsWith(path.join(DATA_DIR, "routes"))) return null;

    try {
        return JSON.parse(await fs.readFile(file, "utf-8")) as RouteDetail;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
}

export async function getSyncMeta() {
    try {
        return JSON.parse(
            await fs.readFile(path.join(DATA_DIR, ".meta.json"), "utf-8")
        );
    } catch {
        return null;
    }
}
