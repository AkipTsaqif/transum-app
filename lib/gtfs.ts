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
 * Which baked dataset to read. All share one file layout, so everything
 * below is mode-agnostic apart from the directory it reads.
 *
 *   gtfs  data/gtfs/  Transjakarta, from the official GTFS feed (sync:gtfs)
 *   krl   data/krl/   KRL Commuter Line, from OpenStreetMap (sync:krl)
 *   mrt   data/mrt/   MRT Jakarta, from OpenStreetMap (sync:mrt)
 *   lrt   data/lrt/   LRT Jakarta (Jakpro), from OpenStreetMap (sync:lrt)
 *   lrtj     data/lrtj/     LRT Jabodebek (PT KAI), from OpenStreetMap (sync:lrt)
 *   bdg-kci  data/bdg-kci/  KAI Commuter Bandung (sync:bandung)
 *   bdg-kai  data/bdg-kai/  Whoosh feeder, PT KAI (sync:bandung)
 *   bdg-mjt  data/bdg-mjt/  Metro Jabar Trans (sync:bandung)
 *   sby-kai        data/sby-kai/        KAI Commuter Area VIII (sync:surabaya)
 *   sby-suroboyo   data/sby-suroboyo/   Suroboyo Bus (sync:surabaya)
 *   sby-transjatim data/sby-transjatim/ Trans Jatim (sync:surabaya)
 */
export type TransitMode =
  | "gtfs"
  | "krl"
  | "mrt"
  | "lrt"
  | "lrtj"
  | "bdg-kci"
  | "bdg-kai"
  | "bdg-mjt"
  | "bdg-tmb"
  | "bdg-damri"
  | "bdg-angkot"
  | "sby-kai"
  | "sby-suroboyo"
  | "sby-transjatim";

/** Every mode, for `generateStaticParams`. */
export const TRANSIT_MODES: TransitMode[] = [
  "gtfs",
  "krl",
  "mrt",
  "lrt",
  "lrtj",
  "bdg-kci",
  "bdg-kai",
  "bdg-mjt",
  "bdg-tmb",
  "bdg-damri",
  "bdg-angkot",
  "sby-kai",
  "sby-suroboyo",
  "sby-transjatim",
];

/**
 * Resolve a mode path segment, or `null` when it is not a real dataset.
 *
 * This used to fall back to `"gtfs"`, which meant an unknown mode served
 * Transjakarta data under someone else's URL. That is the worst failure mode
 * this app has -- wrong data presented as correct -- so an unknown mode is now
 * a missing dataset, and every route answers 404.
 */
export const parseMode = (
  v: string | null | undefined,
): TransitMode | null =>
  TRANSIT_MODES.includes(v as TransitMode) ? (v as TransitMode) : null;

const dataDir = (mode: TransitMode) => path.join(process.cwd(), "data", mode);

/**
 * Per-mode, per-process memo. The files are static between syncs, so each is
 * read once, not per request.
 */
const memo = <T>() => new Map<TransitMode, T>();

/**
 * Baked accessors. `data/gtfs/` is produced by `npm run sync:gtfs` from the
 * official Transjakarta feed; `data/krl/` by `npm run sync:krl`, and
 * `data/mrt/` by `npm run sync:mrt` (shared station centers for both tracks), and
 * `data/lrt/` and `data/lrtj/` by `npm run sync:lrt` (Jakpro line J; KAI's
 * Cibubur and Bekasi with their shared Dukuh Atas-Cawang trunk).
 */

const indexCache = memo<RouteSummary[]>();

export async function getRouteIndex(
  mode: TransitMode = "gtfs",
): Promise<RouteSummary[]> {
  const hit = indexCache.get(mode);
  if (hit) return hit;

  const raw = await fs.readFile(
    path.join(dataDir(mode), "routes.json"),
    "utf-8",
  );
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
  mode: TransitMode = "gtfs",
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
  mode: TransitMode,
): Promise<Map<string, StationIndexEntry>> {
  const hit = stationCache.get(mode);
  if (hit) return hit;

  const raw = await fs.readFile(
    path.join(dataDir(mode), "stops.json"),
    "utf-8",
  );
  const list = JSON.parse(raw) as StationIndexEntry[];
  const map = new Map(list.map((s) => [s.id, s]));
  stationCache.set(mode, map);
  return map;
}

async function expand(
  station: StationIndexEntry | undefined,
  mode: TransitMode,
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
    ...(station.anchors ? { anchors: station.anchors } : {}),
    routes: station.routes
      .map((id): StationRoute | undefined => {
        const r = byId.get(id);
        if (!r) return undefined;
        const pos = station.positions?.[id];
        return pos ? { ...r, position: pos[0], totalStops: pos[1] } : r;
      })
      .filter((r): r is StationRoute => Boolean(r))
      .sort((a, b) =>
        a.route_short_name.localeCompare(b.route_short_name, "en", {
          numeric: true,
        }),
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
  mode: TransitMode = "gtfs",
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
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
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
  mode: TransitMode = "gtfs",
): Promise<StationDetail | null> {
  const stations = await getStationIndex(mode);

  let best: StationIndexEntry | undefined;
  let bestDist = Infinity;

  for (const s of stations.values()) {
    if (s.name !== name) continue;
    const d = Math.min(
      haversine(lat, lon, s.lat, s.lon),
      ...(s.anchors ?? []).map((anchor) =>
        haversine(lat, lon, anchor.lat, anchor.lon),
      ),
    );
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
  mode: TransitMode = "gtfs",
): Promise<ShapeCollection> {
  const hit = overviewCache.get(mode);
  if (hit) return hit;

  const raw = await fs.readFile(
    path.join(dataDir(mode), "overview.json"),
    "utf-8",
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
  mode: TransitMode = "gtfs",
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

/**
 * Stations of the requested city's modes within a straight-line radius, each
 * tagged with its mode and its route summaries. The optional mode list lets
 * walking transfers cross systems but never accidentally cross cities.
 * Per-mode indexes are memoised.
 */
export async function getNearbyStations(
  lat: number,
  lon: number,
  radiusM: number,
  modes: readonly TransitMode[] = TRANSIT_MODES,
): Promise<
  {
    mode: TransitMode;
    name: string;
    lat: number;
    lon: number;
    distance: number;
    routes: RouteSummary[];
  }[]
> {
  const out: {
    mode: TransitMode;
    name: string;
    lat: number;
    lon: number;
    distance: number;
    routes: RouteSummary[];
  }[] = [];

  for (const mode of modes) {
    const [stations, routes] = await Promise.all([
      getStationIndex(mode),
      getRouteIndex(mode),
    ]);
    const byId = new Map(routes.map((r) => [r.route_id, r]));
    for (const s of stations.values()) {
      const distance = haversine(lat, lon, s.lat, s.lon);
      if (distance > radiusM) continue;
      out.push({
        mode,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        distance,
        routes: s.routes
          .map((id) => byId.get(id))
          .filter((r): r is RouteSummary => Boolean(r)),
      });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

const stopLayerCache = memo<unknown>();

/** Every station as GeoJSON points, for the zoomed-in all-stops layer. */
export async function getStopLayer(
  mode: TransitMode = "gtfs",
): Promise<unknown> {
  const hit = stopLayerCache.get(mode);
  if (hit) return hit;

  const raw = await fs.readFile(
    path.join(dataDir(mode), "stops-geo.json"),
    "utf-8",
  );
  const parsed: unknown = JSON.parse(raw);
  stopLayerCache.set(mode, parsed);
  return parsed;
}

export async function getSyncMeta(mode: TransitMode = "gtfs") {
  try {
    return JSON.parse(
      await fs.readFile(path.join(dataDir(mode), ".meta.json"), "utf-8"),
    );
  } catch {
    return null;
  }
}
