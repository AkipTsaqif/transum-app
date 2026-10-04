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

        // Unique stops served by this route, in first-encountered order.
        const seen = new Set<string>();
        const routeStops: Array<{
            stop_id: string;
            stop_name: string;
            stop_lat: number;
            stop_lon: number;
        }> = [];

        for (const t of myTrips) {
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

    const meta: SyncMeta = {
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        syncedAt: new Date().toISOString(),
        source: FEED_URL,
        counts: {
            routes: routes.length,
            trips: trips.length,
            stops: stops.length,
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
