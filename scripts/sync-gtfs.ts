/**
 * Syncs the official Transjakarta GTFS feed and bakes it into small,
 * ready-to-serve JSON files under `data/gtfs/`.
 *
 *   Source: https://gtfs.transjakarta.co.id/files/file_gtfs.zip
 *   Mirrors: mobilitydatabase.org/feeds/gtfs/mdb-1909
 *            transit.land/feeds/f-transjakarta~id
 *
 * Why bake instead of parsing per-request?
 *   The raw feed is ~2.4 MB zipped / ~10 MB unzipped. Parsing it on every
 *   request and shipping it whole to the browser costs ~30 MB per page load.
 *   The feed only changes about once a month, so we pre-join it at build time:
 *
 *     routes.json          ~60 KB   the sidebar index (no geometry)
 *     routes/<id>.json     ~40 KB   one route's geometry + its stops
 *
 * The upstream server honours ETag / Last-Modified, so an unchanged feed
 * costs us a 304 and zero bytes.
 *
 * Usage:  npm run sync:gtfs  [-- --force]
 */

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import fs from "node:fs/promises";
import path from "node:path";

const FEED_URL = "https://gtfs.transjakarta.co.id/files/file_gtfs.zip";

const DATA_DIR = path.join(process.cwd(), "data", "gtfs");
const ROUTES_DIR = path.join(DATA_DIR, "routes");
const META_PATH = path.join(DATA_DIR, ".meta.json");

/**
 * Stops closer than this that share a base name are treated as one physical
 * station -- a stop and its "Sbr." (across-the-road) twin, or two platforms of
 * the same corridor. Must match the map's clustering distance.
 */
const CLUSTER_RADIUS_M = 55;

/** Be a good citizen: upstream is a single ageing box serving a public good. */
const USER_AGENT =
  "transum-app/0.1 (+https://github.com/transum-app) gtfs-sync";

/** Coordinate precision. 6 dp ~= 0.11 m, well beyond what a bus map needs. */
const COORD_PRECISION = 6;

const FORCE = process.argv.includes("--force");

// ---------------------------------------------------------------- GTFS types

interface RawRoute {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_desc: string;
    route_type: string;
    route_color: string;
    route_text_color: string;
    route_url?: string;
    route_sort_order?: string;
}

interface RawTrip {
    route_id: string;
    trip_id: string;
    shape_id: string;
    trip_headsign: string;
    direction_id: string;
}

interface RawShapePoint {
    shape_id: string;
    shape_pt_lat: string;
    shape_pt_lon: string;
    shape_pt_sequence: string;
}

interface RawStop {
    stop_id: string;
    stop_name: string;
    stop_lat: string;
    stop_lon: string;
    stop_desc?: string;
    parent_station?: string;
    wheelchair_boarding?: string;
}

interface RawStopTime {
    trip_id: string;
    stop_id: string;
    stop_sequence: string;
}

interface SyncMeta {
    etag: string | null;
    lastModified: string | null;
    syncedAt: string;
    source: string;
    counts: Record<string, number>;
}

// -------------------------------------------------------------------- helpers

const round = (n: number) =>
    Number.parseFloat(n.toFixed(COORD_PRECISION));

/** Push into a Map<K, V[]> without the `has` dance. */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V) {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
}

async function readMeta(): Promise<Partial<SyncMeta>> {
    try {
        return JSON.parse(await fs.readFile(META_PATH, "utf-8"));
    } catch {
        return {};
    }
}

async function hasBakedData(): Promise<boolean> {
    try {
        const entries = await fs.readdir(ROUTES_DIR);
        return entries.length > 0;
    } catch {
        return false;
    }
}

/**
 * A route_id may contain `/` or other path-hostile characters, so every id is
 * encoded before it becomes a filename. The API layer encodes the same way.
 */
export const routeFileName = (routeId: string) =>
    `${encodeURIComponent(routeId)}.json`;

/** Perpendicular distance from point `p` to segment `a`-`b`, in degrees. */
function perpendicularDistance(
    p: [number, number],
    a: [number, number],
    b: [number, number]
) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + clamped * dx), p[1] - (a[1] + clamped * dy));
}

/**
 * Ramer-Douglas-Peucker line simplification. Used only for the city-wide
 * overview layer, where an 11 m deviation is sub-pixel at the zooms it renders
 * at. Per-route geometry stays at full fidelity.
 */
function simplifyLine(
    points: [number, number][],
    tolerance: number
): [number, number][] {
    if (points.length < 3) return points;

    let maxDist = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDistance(points[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }

    if (maxDist <= tolerance) return [first, last];

    return [
        ...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplifyLine(points.slice(index), tolerance),
    ];
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
 * Strips the "Sbr." (seberang / opposite side) prefix. Mirrors
 * utils/helper-fn.ts -- duplicated because this script must run standalone at
 * build time without pulling in the app's module graph.
 */
const stripOppositePrefix = (name: string) =>
    (name ?? "").replace(/^Sbr\.\s*/i, "").trim();

/** Stable, URL-safe id for a clustered station. */
const stationId = (name: string, lat: number, lon: number) =>
    `${name}@${lat.toFixed(5)},${lon.toFixed(5)}`;

// ----------------------------------------------------------------------- main

async function main() {
    await fs.mkdir(ROUTES_DIR, { recursive: true });

    const prev = await readMeta();
    const conditional: Record<string, string> = { "User-Agent": USER_AGENT };

    if (!FORCE && prev.etag) conditional["If-None-Match"] = prev.etag;
    if (!FORCE && prev.lastModified)
        conditional["If-Modified-Since"] = prev.lastModified;

    console.log(`→ GET ${FEED_URL}`);

    let res: Response;
    try {
        res = await fetch(FEED_URL, { headers: conditional });
    } catch (err) {
        // Network down. Stale data beats a broken build, but say so loudly.
        if (await hasBakedData()) {
            console.warn(
                `⚠ GTFS fetch failed (${(err as Error).message}). ` +
                    `Keeping existing baked data from ${prev.syncedAt ?? "unknown date"}.`
            );
            return;
        }
        throw new Error(
            `GTFS fetch failed and no baked data exists to fall back on: ${(err as Error).message}`
        );
    }

    if (res.status === 304) {
        console.log(`✓ Feed unchanged since ${prev.lastModified}. Nothing to do.`);
        // A 304 with an empty data dir means the meta file outlived its output.
        if (!(await hasBakedData())) {
            console.warn("⚠ Meta says unchanged but no baked data found — re-run with --force.");
        }
        return;
    }

    if (!res.ok) {
        if (await hasBakedData()) {
            console.warn(
                `⚠ Upstream returned ${res.status}. Keeping existing baked data.`
            );
            return;
        }
        throw new Error(`GTFS fetch failed: ${res.status} ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`✓ Downloaded ${(buf.length / 1048576).toFixed(2)} MB`);

    const zip = new AdmZip(buf);

    const read = <T>(name: string, required = true): T[] => {
        const entry = zip.getEntry(name);
        if (!entry) {
            if (required) throw new Error(`${name} missing from GTFS zip`);
            console.warn(`⚠ optional file ${name} not in feed — skipping`);
            return [];
        }
        return parse(entry.getData().toString("utf-8"), {
            columns: true,
            trim: true,
            skip_empty_lines: true,
            bom: true,
        }) as T[];
    };

    const routes = read<RawRoute>("routes.txt");
    const trips = read<RawTrip>("trips.txt");
    const shapes = read<RawShapePoint>("shapes.txt");
    const stops = read<RawStop>("stops.txt");
    const stopTimes = read<RawStopTime>("stop_times.txt");

    console.log(
        `  routes=${routes.length} trips=${trips.length} ` +
            `shapes=${shapes.length} stops=${stops.length} stop_times=${stopTimes.length}`
    );

    // --- index shapes, sorted by sequence.
    // GTFS does not guarantee file order, and an unsorted LineString renders
    // as a scribble. Sort numerically, not lexically ("10" < "9" as strings).
    const shapesById = new Map<string, RawShapePoint[]>();
    for (const pt of shapes) pushInto(shapesById, pt.shape_id, pt);
    for (const pts of shapesById.values()) {
        pts.sort(
            (a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
        );
    }

    const stopById = new Map(stops.map((s) => [s.stop_id, s]));

    // --- trip -> ordered stop ids
    const stopTimesByTrip = new Map<string, RawStopTime[]>();
    for (const st of stopTimes) pushInto(stopTimesByTrip, st.trip_id, st);
    for (const sts of stopTimesByTrip.values()) {
        sts.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    }

    const tripsByRoute = new Map<string, RawTrip[]>();
    for (const t of trips) pushInto(tripsByRoute, t.route_id, t);

    // --- sidebar index: everything the list needs, nothing it doesn't.
    const index = routes
        .map((r) => ({
            route_id: r.route_id,
            route_short_name: r.route_short_name,
            route_long_name: r.route_long_name,
            route_desc: r.route_desc,
            // Never hand an empty string to a hex parser downstream.
            route_color: /^[0-9a-f]{6}$/i.test(r.route_color ?? "")
                ? r.route_color
                : "6B7280",
            route_text_color: /^[0-9a-f]{6}$/i.test(r.route_text_color ?? "")
                ? r.route_text_color
                : "FFFFFF",
        }))
        .sort((a, b) =>
            a.route_short_name.localeCompare(b.route_short_name, "en", {
                numeric: true,
            })
        );

    await fs.writeFile(path.join(DATA_DIR, "routes.json"), JSON.stringify(index));

    // --- clear stale per-route files so removed routes actually disappear
    for (const f of await fs.readdir(ROUTES_DIR)) {
        if (f.endsWith(".json")) await fs.rm(path.join(ROUTES_DIR, f));
    }

    let totalBytes = 0;
    let withoutGeometry = 0;

    for (const r of routes) {
        const myTrips = tripsByRoute.get(r.route_id) ?? [];

        const shapeIds = [
            ...new Set(myTrips.map((t) => t.shape_id).filter(Boolean)),
        ];

        const features = shapeIds
            .filter((id) => shapesById.has(id))
            .map((id) => ({
                type: "Feature" as const,
                properties: { shape_id: id },
                geometry: {
                    type: "LineString" as const,
                    coordinates: shapesById
                        .get(id)!
                        .map((p) => [
                            round(Number(p.shape_pt_lon)),
                            round(Number(p.shape_pt_lat)),
                        ]),
                },
            }));

        if (features.length === 0) withoutGeometry++;

        // Unique stops served by this route, in call order.
        //
        // `stop_sequence` is per *trip*, and a route has many trips (both
        // directions). Walking the longest trip first gives a stable, sensible
        // ordering; stops only reachable on other trips are appended after.
        const seen = new Set<string>();
        const routeStops: Array<{
            stop_id: string;
            stop_name: string;
            stop_lat: number;
            stop_lon: number;
            sequence: number;
        }> = [];

        const tripsByLength = [...myTrips].sort(
            (a, b) =>
                (stopTimesByTrip.get(b.trip_id)?.length ?? 0) -
                (stopTimesByTrip.get(a.trip_id)?.length ?? 0)
        );

        for (const t of tripsByLength) {
            for (const st of stopTimesByTrip.get(t.trip_id) ?? []) {
                if (seen.has(st.stop_id)) continue;
                seen.add(st.stop_id);
                const s = stopById.get(st.stop_id);
                if (!s) continue;
                routeStops.push({
                    stop_id: s.stop_id,
                    stop_name: s.stop_name,
                    stop_lat: round(Number(s.stop_lat)),
                    stop_lon: round(Number(s.stop_lon)),
                    // 1-based position for display ("halte ke-12 dari 28").
                    sequence: routeStops.length + 1,
                });
            }
        }

        const payload = JSON.stringify({
            route_id: r.route_id,
            route_short_name: r.route_short_name,
            route_long_name: r.route_long_name,
            route_color: /^[0-9a-f]{6}$/i.test(r.route_color ?? "")
                ? r.route_color
                : "6B7280",
            geometry: { type: "FeatureCollection", features },
            stops: routeStops,
        });

        totalBytes += payload.length;
        await fs.writeFile(
            path.join(ROUTES_DIR, routeFileName(r.route_id)),
            payload
        );
    }

    // ---------------------------------------------------------------- stations
    //
    // Group stops into the same clusters the map renders, then record which
    // routes serve each one. This is what makes "click a stop, see every route
    // that calls there" a single small fetch instead of a scan over all routes.

    interface Station {
        name: string;
        lat: number;
        lon: number;
        count: number;
        stopIds: string[];
        routes: Set<string>;
    }

    // Bucket by base name first; clustering only ever merges same-named stops,
    // so this keeps the distance comparison near-linear instead of O(n^2).
    const byName = new Map<string, Station[]>();

    const routeIdsByStop = new Map<string, Set<string>>();
    for (const r of routes) {
        for (const t of tripsByRoute.get(r.route_id) ?? []) {
            for (const st of stopTimesByTrip.get(t.trip_id) ?? []) {
                const set = routeIdsByStop.get(st.stop_id);
                if (set) set.add(r.route_id);
                else routeIdsByStop.set(st.stop_id, new Set([r.route_id]));
            }
        }
    }

    for (const s of stops) {
        const lat = Number(s.stop_lat);
        const lon = Number(s.stop_lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const serving = routeIdsByStop.get(s.stop_id);
        if (!serving?.size) continue; // orphan stop, no route calls here

        const name = stripOppositePrefix(s.stop_name);
        const bucket = byName.get(name) ?? [];

        let merged = false;
        for (const st of bucket) {
            if (haversine(lat, lon, st.lat, st.lon) >= CLUSTER_RADIUS_M) continue;
            st.lat = (st.lat * st.count + lat) / (st.count + 1);
            st.lon = (st.lon * st.count + lon) / (st.count + 1);
            st.count += 1;
            st.stopIds.push(s.stop_id);
            for (const r of serving) st.routes.add(r);
            merged = true;
            break;
        }

        if (!merged) {
            bucket.push({
                name,
                lat,
                lon,
                count: 1,
                stopIds: [s.stop_id],
                routes: new Set(serving),
            });
            byName.set(name, bucket);
        }
    }

    const stations = [...byName.values()].flat();

    // Where each station falls along each route, so the UI can say
    // "halte ke-12 dari 28". Keyed route_id -> stop_id -> [position, total].
    const positionByRouteStop = new Map<string, Map<string, [number, number]>>();
    for (const r of routes) {
        const file = JSON.parse(
            await fs.readFile(
                path.join(ROUTES_DIR, routeFileName(r.route_id)),
                "utf-8"
            )
        ) as { stops: Array<{ stop_id: string; sequence: number }> };
        const inner = new Map<string, [number, number]>();
        for (const s of file.stops) inner.set(s.stop_id, [s.sequence, file.stops.length]);
        positionByRouteStop.set(r.route_id, inner);
    }

    // One index file rather than 6437 tiny ones: the whole thing is ~930 KB
    // raw / ~200 KB gzipped, cheaper to serve once than to pay a request per
    // stop, and it avoids adding thousands of near-empty objects to git.
    // Route metadata is already in routes.json, so only ids are stored here.
    const stationIndex = stations.map((st) => ({
        id: stationId(st.name, st.lat, st.lon),
        name: st.name,
        lat: round(st.lat),
        lon: round(st.lon),
        platforms: st.count,
        routes: [...st.routes].sort(),
        // route_id -> [position, total] for any member platform.
        positions: Object.fromEntries(
            [...st.routes]
                .map((rid) => {
                    const inner = positionByRouteStop.get(rid);
                    for (const sid of st.stopIds) {
                        const hit = inner?.get(sid);
                        if (hit) return [rid, hit] as const;
                    }
                    return null;
                })
                .filter((x): x is readonly [string, [number, number]] => !!x)
        ),
    }));

    await fs.writeFile(
        path.join(DATA_DIR, "stops.json"),
        JSON.stringify(stationIndex)
    );

    // ---------------------------------------------------------------- overview
    //
    // Every route in one simplified FeatureCollection, drawn faintly when
    // nothing is selected so the app opens looking like a transit map rather
    // than an empty basemap. Fetching the 240 real route files instead would
    // be 240 requests and ~800 KB gzipped; this is one request and ~180 KB.
    const OVERVIEW_TOLERANCE = 0.0002; // ~22 m, still sub-pixel below zoom 14
    const OVERVIEW_PRECISION = 5; // ~1.1 m, ample for a context layer

    interface OverviewFeature {
        type: "Feature";
        properties: { color: string };
        geometry: { type: "LineString"; coordinates: [number, number][] };
    }

    const ovRound = (n: number) =>
        Number.parseFloat(n.toFixed(OVERVIEW_PRECISION));

    const overviewFeatures: OverviewFeature[] = [];
    // Shapes are shared between routes and directions; draw each once.
    const drawnShapes = new Set<string>();

    for (const r of routes) {
        const color = /^[0-9a-f]{6}$/i.test(r.route_color ?? "")
            ? r.route_color
            : "6B7280";

        const shapeIds = [
            ...new Set(
                (tripsByRoute.get(r.route_id) ?? [])
                    .map((t) => t.shape_id)
                    .filter(Boolean)
            ),
        ];

        for (const id of shapeIds) {
            if (drawnShapes.has(id)) continue;
            drawnShapes.add(id);

            const pts = shapesById.get(id);
            if (!pts) continue;

            const coords = simplifyLine(
                pts.map(
                    (p) =>
                        [
                            ovRound(Number(p.shape_pt_lon)),
                            ovRound(Number(p.shape_pt_lat)),
                        ] as [number, number]
                ),
                OVERVIEW_TOLERANCE
            );
            if (coords.length < 2) continue;

            overviewFeatures.push({
                type: "Feature",
                properties: { color: `#${color}` },
                geometry: { type: "LineString", coordinates: coords },
            });
        }
    }

    const overview = JSON.stringify({
        type: "FeatureCollection",
        features: overviewFeatures,
    });
    await fs.writeFile(path.join(DATA_DIR, "overview.json"), overview);

    const overviewPoints = overviewFeatures.reduce(
        (a, f) => a + f.geometry.coordinates.length,
        0
    );
    console.log(
        `\u2713 Baked overview: ${overviewFeatures.length} lines, ` +
            `${overviewPoints.toLocaleString()} points, ` +
            `${(overview.length / 1048576).toFixed(2)} MB raw`
    );

    // Every station as a Point layer, for the "show all stops when zoomed in"
    // view. Rendered by the GPU as circles, so 6,437 points cost one draw call
    // -- the same count as DOM markers would be 6,437 React components and an
    // O(n^2) clustering pass.
    //
    // Only name and id travel: enough to label a pin and resolve a click.
    const stopsGeoJson = JSON.stringify({
        type: "FeatureCollection",
        features: stationIndex.map((s) => ({
            type: "Feature",
            properties: { name: s.name, routes: s.routes.length },
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        })),
    });
    await fs.writeFile(
        path.join(DATA_DIR, "stops-geo.json"),
        stopsGeoJson
    );
    console.log(
        `\u2713 Baked stop layer: ${stationIndex.length} points, ` +
            `${(stopsGeoJson.length / 1048576).toFixed(2)} MB raw`
    );

    const stationRouteCounts = stationIndex.map((s) => s.routes.length);
    console.log(
        `\u2713 Baked ${stations.length} stations ` +
            `(index ${(JSON.stringify(stationIndex).length / 1024).toFixed(0)} KB, ` +
            `max ${Math.max(...stationRouteCounts)} routes at one stop)`
    );

    const meta: SyncMeta = {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        syncedAt: new Date().toISOString(),
        source: FEED_URL,
        counts: {
            routes: routes.length,
            trips: trips.length,
            stops: stops.length,
            stations: stations.length,
            shapePoints: shapes.length,
            stopTimes: stopTimes.length,
        },
    };

    await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2));

    const avg = totalBytes / Math.max(routes.length, 1) / 1024;
    console.log(
        `✓ Baked ${routes.length} routes ` +
            `(index ${(JSON.stringify(index).length / 1024).toFixed(0)} KB, ` +
            `avg route ${avg.toFixed(0)} KB)`
    );
    if (withoutGeometry > 0) {
        console.warn(`⚠ ${withoutGeometry} route(s) have no shape geometry.`);
    }
    console.log(`  feed Last-Modified: ${meta.lastModified}`);
}

main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
});
