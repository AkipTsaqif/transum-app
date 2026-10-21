import type { FeatureCollection, LineString, Point } from "geojson";
import type {
  RouteDetail,
  RouteSummary,
  StationIndexEntry,
} from "./types/gtfs";

export const MRT_RELATIONS = [9677669, 9677670] as const;
type LngLat = [number, number];
interface OsmNode {
  type: "node";
  id: number;
  lon: number;
  lat: number;
  tags?: Record<string, string>;
}
interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
interface OsmRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members: { type: "node" | "way" | "relation"; ref: number; role: string }[];
}
export interface OsmMrtDocument {
  elements: (OsmNode | OsmWay | OsmRelation)[];
}
const metres = (a: LngLat, b: LngLat) =>
  Math.hypot(
    (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
    (a[1] - b[1]) * 110_540,
  );
const round = (n: number) => Number(n.toFixed(7));
// Stable base names/codes, independent of naming-rights changes.
const STATION_BASES = [
  "lebak bulus",
  "fatmawati",
  "cipete raya",
  "haji nawi",
  "blok a",
  "blok m",
  "asean",
  "senayan",
  "istora",
  "bendungan hilir",
  "setiabudi",
  "dukuh atas",
  "bundaran hi",
];
const stationKey = (name: string) =>
  STATION_BASES.find((base) => name.toLowerCase().startsWith(base));
const STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);

/** Join unordered/reversed OSM track ways, never bridge a missing way. */
function chainTrack(
  ways: OsmWay[],
  nodes: Map<number, OsmNode>,
  first: LngLat,
): LngLat[] {
  const pool = ways.map((way) => {
    if (way.tags?.railway !== "subway")
      throw new Error(`MRT way ${way.id} is not operating subway track`);
    return way.nodes.map((id): LngLat => {
      const node = nodes.get(id);
      if (!node) throw new Error(`MRT missing track node ${id}`);
      return [node.lon, node.lat];
    });
  });
  if (!pool.length || pool.some((points) => points.length < 2))
    throw new Error("MRT has no usable track ways");
  let line = pool.shift()!;
  while (pool.length) {
    const index = pool.findIndex((p) =>
      [p[0], p.at(-1)!].some(
        (end) => metres(end, line[0]) < 2 || metres(end, line.at(-1)!) < 2,
      ),
    );
    if (index < 0) throw new Error("MRT track ways are disconnected");
    const points = pool.splice(index, 1)[0];
    if (metres(points[0], line.at(-1)!) < 2)
      line = line.concat(points.slice(1));
    else if (metres(points.at(-1)!, line.at(-1)!) < 2)
      line = line.concat([...points].reverse().slice(1));
    else if (metres(points.at(-1)!, line[0]) < 2)
      line = points.concat(line.slice(1));
    else line = [...points].reverse().concat(line.slice(1));
  }
  return metres(line[0], first) <= metres(line.at(-1)!, first)
    ? line
    : line.reverse();
}

function projection(line: LngLat[], point: LngLat) {
  let best = { distance: Infinity, segment: 0, t: 0, point: line[0] };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i],
      b = line[i + 1];
    const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx,
      dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * kx,
      py = (point[1] - a[1]) * 110_540;
    const t =
      dx || dy
        ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
        : 0;
    const distance = Math.hypot(px - dx * t, py - dy * t);
    if (distance < best.distance)
      best = {
        distance,
        segment: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      };
  }
  return best;
}

function extract(document: OsmMrtDocument, relationId: number) {
  const nodes = new Map(
    document.elements
      .filter((e): e is OsmNode => e.type === "node")
      .map((n) => [n.id, n]),
  );
  const ways = new Map(
    document.elements
      .filter((e): e is OsmWay => e.type === "way")
      .map((w) => [w.id, w]),
  );
  const relation = document.elements.find(
    (e): e is OsmRelation => e.type === "relation" && e.id === relationId,
  );
  if (
    !relation ||
    relation.tags?.route !== "subway" ||
    relation.tags?.network !== "MRT Jakarta"
  ) {
    throw new Error(
      `MRT relation ${relationId} is not an operating MRT Jakarta subway route`,
    );
  }
  const calls = relation.members
    .filter((m) => m.type === "node" && STOP_ROLES.has(m.role))
    .map((member) => {
      const node = nodes.get(member.ref);
      const name = node?.tags?.name;
      if (!node || !name || !stationKey(name))
        throw new Error(`Unknown MRT station ${member.ref}`);
      return {
        name,
        key: stationKey(name)!,
        point: [node.lon, node.lat] as LngLat,
      };
    });
  if (
    calls.length !== 13 ||
    new Set(calls.map((call) => call.key)).size !== 13
  ) {
    throw new Error(
      "MRT must serve exactly the 13 open stations, with no duplicates",
    );
  }
  const track = relation.members
    .filter((m) => m.type === "way")
    .map((m) => {
      const way = ways.get(m.ref);
      if (!way) throw new Error(`MRT missing track way ${m.ref}`);
      return way;
    });
  const line = chainTrack(track, nodes, calls[0].point);
  let previous = -1;
  for (const call of calls) {
    const position = projection(line, call.point);
    if (position.distance > 40 || position.segment + position.t < previous) {
      throw new Error(`MRT station ${call.name} is off-track or out of order`);
    }
    previous = position.segment + position.t;
  }
  return { line, calls };
}

/** Pure baker shared by the sync CLI and offline tests. Track geometry stays
 * geographic; each shared station marker is centered between the direction
 * stops. Terminal shapes meet that marker rather than buffer-stop tracks. */
export function bakeMrt(documents: OsmMrtDocument[]) {
  if (documents.length !== 2)
    throw new Error("MRT needs both route directions");
  const directions = documents.map((document, i) =>
    extract(document, MRT_RELATIONS[i]),
  );
  const [outbound, inbound] = directions;
  if (
    outbound.calls.map((c) => c.key).join() !== STATION_BASES.join() ||
    inbound.calls.map((c) => c.key).join() !==
      [...STATION_BASES].reverse().join()
  ) {
    throw new Error("MRT directions must run Lebak Bulus–Bundaran HI and back");
  }
  const summary: RouteSummary = {
    route_id: "M",
    route_short_name: "M",
    route_long_name: "Lebak Bulus - Bundaran HI",
    route_desc: "Lin Utara–Selatan MRT Jakarta",
    route_color: "CE0037",
    route_text_color: "FFFFFF",
  };
  const inboundCalls = new Map(inbound.calls.map((call) => [call.key, call]));
  const stops = outbound.calls.map((call, i) => {
    // Match by the stable station key, not direction order or sponsored name.
    // The midpoint represents both platforms instead of favouring northbound.
    const opposite = inboundCalls.get(call.key)!;
    return {
      stop_id: `NS${String(i + 1).padStart(2, "0")}`,
      stop_name: call.name,
      stop_lat: round((call.point[1] + opposite.point[1]) / 2),
      stop_lon: round((call.point[0] + opposite.point[0]) / 2),
      sequence: i + 1,
    };
  });
  const stopIds = new Map(
    outbound.calls.map((call, i) => [call.key, stops[i].stop_id]),
  );
  const variants = directions.map((direction, i) => ({
    trip_id: `M-${i}`,
    shape_id: `M-${i}`,
    direction_id: String(i),
    kind: "utama" as const,
    headsign: stops.find(
      (s) => s.stop_id === stopIds.get(direction.calls.at(-1)!.key),
    )!.stop_name,
    via: null,
    service_id: "OSM",
    headwaySecs: null,
    windows: [],
    stopCount: 13,
    extraStops: [],
    skippedStops: [],
    stopIds: direction.calls.map((call) => stopIds.get(call.key)!),
  }));
  const geometryByShape = Object.fromEntries(
    directions.map((direction, i) => {
      const start = projection(direction.line, direction.calls[0].point);
      const end = projection(direction.line, direction.calls.at(-1)!.point);
      const first = stops.find((s) => s.stop_id === variants[i].stopIds[0])!;
      const last = stops.find((s) => s.stop_id === variants[i].stopIds.at(-1))!;
      const coordinates: LngLat[] = [
        [first.stop_lon, first.stop_lat],
        ...direction.line.slice(start.segment + 1, end.segment + 1),
        [last.stop_lon, last.stop_lat],
      ];
      const line = coordinates
        .map(([lon, lat]): LngLat => [round(lon), round(lat)])
        .filter((point, j, all) => !j || metres(point, all[j - 1]) > 0.01);
      return [variants[i].shape_id, line];
    }),
  );
  const route: RouteDetail = { ...summary, stops, variants, geometryByShape };
  const stations: StationIndexEntry[] = stops.map((stop) => ({
    id: `${stop.stop_name}@${stop.stop_lat.toFixed(5)},${stop.stop_lon.toFixed(5)}`,
    name: stop.stop_name,
    lat: stop.stop_lat,
    lon: stop.stop_lon,
    platforms: 2,
    routes: ["M"],
    positions: { M: [stop.sequence, stops.length] },
  }));
  const stopLayer: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      properties: { name: s.name, routes: 1, stationId: s.id },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
  const overview: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: variants.map((v) => ({
      type: "Feature",
      properties: { color: "#CE0037", opacity: 1, width: 3 },
      geometry: {
        type: "LineString",
        coordinates: geometryByShape[v.shape_id],
      },
    })),
  };
  return { route, routes: [summary], stations, stopLayer, overview };
}
