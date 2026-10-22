import type { FeatureCollection, LineString, Point } from "geojson";
import type {
  RouteDetail,
  RouteSummary,
  StationIndexEntry,
} from "./types/gtfs";
import {
  chainTrack,
  metres,
  projection,
  round,
  STOP_ROLES,
  type LngLat,
  type OsmDocument,
  type OsmNode,
  type OsmRelation,
  type OsmWay,
} from "./rail-geometry";

export const MRT_RELATIONS = [9677669, 9677670] as const;
export type OsmMrtDocument = OsmDocument;
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
  const line = chainTrack(track, nodes, calls[0].point, "MRT", "subway");
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
