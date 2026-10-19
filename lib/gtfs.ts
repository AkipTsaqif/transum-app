import fs from "node:fs/promises";
import path from "node:path";
import type {
    RouteDetail,
    RouteSummary,
    ShapeCollection,
    StationDetail,
    StationIndexEntry,
    StationRoute,
    StationSearchHit,
} from "@/utils/types/gtfs";

/**
 * Which baked dataset to read. Both share one file layout, so everything
 * below is mode-agnostic apart from the directory it reads.
 *
 *   gtfs  data/gtfs/  Transjakarta, from the official GTFS feed (sync:gtfs)
 *   krl   data/krl/   KRL Commuter Line, from OpenStreetMap (sync:krl)
 */
export type TransitMode = "gtfs" | "krl";

/** Every mode, for `generateStaticParams`. */
export const TRANSIT_MODES: TransitMode[] = ["gtfs", "krl"];

/** Anything unrecognised falls back to the default rather than erroring. */
export const parseMode = (v: string | null | undefined): TransitMode =>
    v === "krl" ? "krl" : "gtfs";

const dataDir = (mode: TransitMode) => path.join(process.cwd(), "data", mode);

/**
 * Per-mode, per-process memo. The files are static between syncs, so each is
 * read once, not per request.
 */
const memo = <T>() => new Map<TransitMode, T>();

/**
 * Baked accessors. `data/gtfs/` is produced by `npm run sync:gtfs` from the
 * official Transjakarta feed; `data/krl/` by `npm run sync:krl`.
 */

const indexCache = memo<RouteSummary[]>();

export async function getRouteIndex(
    mode: TransitMode = "gtfs"
): Promise<RouteSummary[]> {
    const hit = indexCache.get(mode);
    if (hit) return hit;

    const raw = await fs.readFile(path.join(dataDir(mode), "routes.json"), "utf-8");
    const parsed = JSON.parse(raw) as RouteSummary[];
    indexCache.set(mode, parsed);
    return parsed;
}

/**
 * One route's geometry and stops. Returns null when the id is unknown so the
 * caller can answer 404 instead of leaking an ENOENT stack trace.
 *
 * `encodeURIComponent` mirrors the filename encoding used by the sync script,
 * and also prevents `..` traversal from reaching the filesystem.
 */
export async function getRouteDetail(
    routeId: string,
    mode: TransitMode = "gtfs"
): Promise<RouteDetail | null> {
    const dir = path.join(dataDir(mode), "routes");
    const file = path.join(dir, `${encodeURIComponent(routeId)}.json`);

    // Defence in depth: the encoded name can never escape, but assert it anyway.
    if (!file.startsWith(dir)) return null;

    try {
        return JSON.parse(await fs.readFile(file, "utf-8")) as RouteDetail;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
}

const stationCache = memo<Map<string, StationIndexEntry>>();

async function getStationIndex(
    mode: TransitMode
): Promise<Map<string, StationIndexEntry>> {
    const hit = stationCache.get(mode);
    if (hit) return hit;

    const raw = await fs.readFile(path.join(dataDir(mode), "stops.json"), "utf-8");
    const list = JSON.parse(raw) as StationIndexEntry[];
    const map = new Map(list.map((s) => [s.id, s]));
    stationCache.set(mode, map);
    return map;
}

async function expand(
    station: StationIndexEntry | undefined,
    mode: TransitMode
): Promise<StationDetail | null> {
    if (!station) return null;

    const routes = await getRouteIndex(mode);
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
    stationId: string,
    mode: TransitMode = "gtfs"
): Promise<StationDetail | null> {
    const stations = await getStationIndex(mode);
    return expand(stations.get(stationId), mode);
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
    lon: number,
    mode: TransitMode = "gtfs"
): Promise<StationDetail | null> {
    const stations = await getStationIndex(mode);

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

    return expand(best, mode);
}

const overviewCache = memo<ShapeCollection>();

/**
 * Every route as one simplified FeatureCollection (~194 KB gzipped), drawn
 * faintly when nothing is selected. Simplified to ~11 m, which is sub-pixel at
 * the zooms this renders at; per-route geometry stays full fidelity.
 */
export async function getOverview(
    mode: TransitMode = "gtfs"
): Promise<ShapeCollection> {
    const hit = overviewCache.get(mode);
    if (hit) return hit;

    const raw = await fs.readFile(
        path.join(dataDir(mode), "overview.json"),
        "utf-8"
    );
    const parsed = JSON.parse(raw) as ShapeCollection;
    overviewCache.set(mode, parsed);
    return parsed;
}

/**
 * Substring search over station names, ranked so prefix matches come first
 * and busier interchanges outrank single-route stops.
 */
export async function searchStations(
    query: string,
    limit = 20,
    mode: TransitMode = "gtfs"
): Promise<StationSearchHit[]> {
    const stations = await getStationIndex(mode);
    const q = query.toLowerCase();

    const hits: Array<StationSearchHit & { rank: number }> = [];

    for (const s of stations.values()) {
        const idx = s.name.toLowerCase().indexOf(q);
        if (idx === -1) continue;

        hits.push({
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            routeCount: s.routes.length,
            // Earlier match wins; ties broken by how many routes call there.
            rank: idx * 1000 - s.routes.length,
        });
    }

    hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

    return hits.slice(0, limit).map(({ rank, ...rest }) => {
        void rank;
        return rest;
    });
}

const stopLayerCache = memo<unknown>();

/** Every station as GeoJSON points, for the zoomed-in all-stops layer. */
export async function getStopLayer(
    mode: TransitMode = "gtfs"
): Promise<unknown> {
    const hit = stopLayerCache.get(mode);
    if (hit) return hit;

    const raw = await fs.readFile(
        path.join(dataDir(mode), "stops-geo.json"),
        "utf-8"
    );
    const parsed: unknown = JSON.parse(raw);
    stopLayerCache.set(mode, parsed);
    return parsed;
}

export async function getSyncMeta(mode: TransitMode = "gtfs") {
    try {
        return JSON.parse(
            await fs.readFile(path.join(dataDir(mode), ".meta.json"), "utf-8")
        );
    } catch {
        return null;
    }
}
