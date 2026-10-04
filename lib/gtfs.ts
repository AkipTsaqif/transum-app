import fs from "node:fs/promises";
import path from "node:path";
import type {
    RouteDetail,
    RouteSummary,
    ShapeCollection,
    StationDetail,
    StationIndexEntry,
    StationRoute,
} from "@/utils/types/gtfs";

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

let stationCache: Map<string, StationIndexEntry> | null = null;

async function getStationIndex(): Promise<Map<string, StationIndexEntry>> {
    if (stationCache) return stationCache;

    const raw = await fs.readFile(path.join(DATA_DIR, "stops.json"), "utf-8");
    const list = JSON.parse(raw) as StationIndexEntry[];
    stationCache = new Map(list.map((s) => [s.id, s]));
    return stationCache;
}

async function expand(
    station: StationIndexEntry | undefined
): Promise<StationDetail | null> {
    if (!station) return null;

    const routes = await getRouteIndex();
    const byId = new Map(routes.map((r) => [r.route_id, r]));

    return {
        id: station.id,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        platforms: station.platforms,
        routes: station.routes
            .map((id): StationRoute | undefined => {
                const r = byId.get(id);
                if (!r) return undefined;
                const pos = station.positions?.[id];
                return pos
                    ? { ...r, position: pos[0], totalStops: pos[1] }
                    : r;
            })
            .filter((r): r is StationRoute => Boolean(r))
            .sort((a, b) =>
                a.route_short_name.localeCompare(b.route_short_name, "en", {
                    numeric: true,
                })
            ),
    };
}

/**
 * A station plus the full summary of every route that calls there.
 *
 * The 922 KB station index is read once per server process and kept in memory;
 * clients only ever receive the single ~1-3 KB station they asked for.
 */
export async function getStationDetail(
    stationId: string
): Promise<StationDetail | null> {
    const stations = await getStationIndex();
    return expand(stations.get(stationId));
}

/** Metres between two lat/lon pairs. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dp / 2) ** 2 +
        Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Finds the clustered station containing a raw GTFS stop. Matches on base name
 * first, then nearest centroid -- the same name can legitimately appear in
 * several parts of the city.
 */
export async function resolveStation(
    name: string,
    lat: number,
    lon: number
): Promise<StationDetail | null> {
    const stations = await getStationIndex();

    let best: StationIndexEntry | undefined;
    let bestDist = Infinity;

    for (const s of stations.values()) {
        if (s.name !== name) continue;
        const d = haversine(lat, lon, s.lat, s.lon);
        if (d < bestDist) {
            bestDist = d;
            best = s;
        }
    }

    // Generous ceiling: the cluster centroid can sit a little way from any one
    // platform, but a match kilometres away means we picked the wrong station.
    if (!best || bestDist > 500) return null;

    return expand(best);
}

let overviewCache: ShapeCollection | null = null;

/**
 * Every route as one simplified FeatureCollection (~194 KB gzipped), drawn
 * faintly when nothing is selected. Simplified to ~11 m, which is sub-pixel at
 * the zooms this renders at; per-route geometry stays full fidelity.
 */
export async function getOverview(): Promise<ShapeCollection> {
    if (overviewCache) return overviewCache;

    const raw = await fs.readFile(
        path.join(DATA_DIR, "overview.json"),
        "utf-8"
    );
    overviewCache = JSON.parse(raw) as ShapeCollection;
    return overviewCache;
}

let stopLayerCache: unknown = null;

/** Every station as GeoJSON points, for the zoomed-in all-stops layer. */
export async function getStopLayer(): Promise<unknown> {
    if (stopLayerCache) return stopLayerCache;

    const raw = await fs.readFile(
        path.join(DATA_DIR, "stops-geo.json"),
        "utf-8"
    );
    stopLayerCache = JSON.parse(raw);
    return stopLayerCache;
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
