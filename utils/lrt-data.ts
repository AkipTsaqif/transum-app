import type { FeatureCollection, LineString, Point } from "geojson";
import type {
  RouteDetail,
  RouteSummary,
  StationIndexEntry,
} from "./types/gtfs";
import type { TransitMode } from "@/lib/gtfs";
import { railLineOffset } from "./line-offset";
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

export type OsmLrtDocument = OsmDocument;

export interface LrtLine {
  id: string;
  longName: string;
  desc: string;
  color: string;
  /** [outbound, return] OSM route relations. */
  relations: readonly [number, number];
  /** Stable lowercase base names in outbound order (sponsor suffixes ignored). */
  stations: readonly string[];
  /** Overview/route network label the relations must carry. */
  network: string;
}
export type LrtLines = Record<"J" | "CB" | "BK", LrtLine>;

/**
 * Operating lines only. LRT Jakarta Fase 1B (Velodrome - Manggarai) opened on
 * 16 Sep 2026, so the whole Lin Selatan is in service. Cibubur and Bekasi run
 * the same Dukuh Atas - Cawang trunk, which is why their stations merge.
 */
export const LRT_LINES: LrtLines = {
  J: {
    id: "J",
    longName: "Manggarai - Kelapa Gading",
    desc: "LRT Jakarta Lin Selatan",
    color: "F16227",
    relations: [10693119, 10693160],
    network: "LRT Jakarta",
    stations: [
      "manggarai",
      "proklamasi",
      "matraman",
      "pramuka",
      "rawamangun",
      "velodrome",
      "equestrian",
      "pulomas",
      "boulevard selatan",
      "boulevard utara",
      "kelapa gading",
    ],
  },
  CB: {
    id: "CB",
    longName: "Dukuh Atas - Harjamukti",
    desc: "LRT Jabodebek Lintas Cibubur",
    color: "20409A",
    relations: [16036440, 16036441],
    network: "Jabodebek LRT",
    stations: [
      "dukuh atas",
      "setiabudi",
      "rasuna said",
      "kuningan",
      "pancoran",
      "cikoko",
      "ciliwung",
      "cawang",
      "taman mini",
      "kampung rambutan",
      "ciracas",
      "harjamukti",
    ],
  },
  BK: {
    id: "BK",
    longName: "Dukuh Atas - Jatimulya",
    desc: "LRT Jabodebek Lintas Bekasi",
    color: "0E6938",
    // Outbound is Dukuh Atas -> Jatimulya, so the order here is deliberately
    // 16079479 then 16079478 (the OSM ids are not in travel order).
    relations: [16079479, 16079478],
    network: "Jabodebek LRT",
    stations: [
      "dukuh atas",
      "setiabudi",
      "rasuna said",
      "kuningan",
      "pancoran",
      "cikoko",
      "ciliwung",
      "cawang",
      "halim",
      "jatibening baru",
      "cikunir 1",
      "cikunir 2",
      "bekasi barat",
      "jatimulya",
    ],
  },
};

/**
 * The two LRT systems are separate modes. LRT Jakarta (line J) is run by
 * Jakarta's provincial government through Jakpro; LRT Jabodebek (Cibubur and
 * Bekasi) by PT KAI. They share no station, so each has its own dataset and
 * its own entry in the mode picker.
 */
export const LRT_SYSTEMS = {
  jakarta: {
    mode: "lrt",
    dir: "lrt",
    label: "LRT Jakarta",
    lines: ["J"],
  },
  jabodebek: {
    mode: "lrtj",
    dir: "lrtj",
    label: "LRT Jabodebek",
    lines: ["CB", "BK"],
  },
} as const satisfies Record<
  string,
  {
    mode: string;
    dir: string;
    label: string;
    lines: readonly (keyof LrtLines)[];
  }
>;
export type LrtSystem = keyof typeof LRT_SYSTEMS;

/** Every relation id one system needs, in the order bakeLrt expects them. */
export const lrtRelations = (system: LrtSystem) =>
  LRT_SYSTEMS[system].lines.flatMap((id) => LRT_LINES[id].relations);

function stationKey(line: LrtLine, name: string) {
  const lower = name.toLowerCase();
  return line.stations.find((base) => lower.startsWith(base));
}

function extract(document: OsmLrtDocument, line: LrtLine, relationId: number) {
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
    relation.tags?.route !== "light_rail" ||
    relation.tags?.network !== line.network
  ) {
    throw new Error(
      `LRT relation ${relationId} is not an operating light_rail route of ${line.network}`,
    );
  }
  const calls = relation.members
    .filter((m) => m.type === "node" && STOP_ROLES.has(m.role))
    .map((member) => {
      const node = nodes.get(member.ref);
      const name = node?.tags?.name;
      const key = name ? stationKey(line, name) : undefined;
      if (!node || !name || !key)
        throw new Error(`Unknown ${line.id} station ${member.ref}`);
      return { name, key, point: [node.lon, node.lat] as LngLat };
    });
  if (
    calls.length !== line.stations.length ||
    new Set(calls.map((call) => call.key)).size !== line.stations.length
  ) {
    throw new Error(
      `LRT ${line.id} expected ${line.stations.length} stations, with no duplicates, got ${calls.length}`,
    );
  }
  const track = relation.members
    .filter((m) => m.type === "way")
    .map((m) => {
      const way = ways.get(m.ref);
      if (!way) throw new Error(`LRT ${line.id} missing track way ${m.ref}`);
      return way;
    });
  const trackLine = chainTrack(
    track,
    nodes,
    calls[0].point,
    `LRT ${line.id}`,
    "light_rail",
  );
  let previous = -1;
  for (const call of calls) {
    const position = projection(trackLine, call.point);
    if (position.distance > 40 || position.segment + position.t < previous) {
      throw new Error(
        `LRT ${line.id} station ${call.name} is off-track or out of order`,
      );
    }
    previous = position.segment + position.t;
  }
  return { line: trackLine, calls };
}

/**
 * Pure baker shared by the sync CLI and the offline tests. Bakes ONE system:
 * `lines` in order, and two OSM documents per line (outbound, then return).
 * Track geometry stays
 * geographic; a station's marker is the mean of every platform that serves it
 * (both directions of every line calling there), so Cawang or Dukuh Atas is a
 * single point rather than hugging whichever track was read first.
 */
export function bakeLrt(
  documents: OsmLrtDocument[],
  lines: LrtLine[],
  // Which mode the overview is drawn in; offsets are mode-scoped. Required:
  // a default would silently give Jabodebek LRT Jakarta's (empty) offsets.
  mode: TransitMode,
) {
  if (!lines.length || documents.length !== lines.length * 2) {
    throw new Error("LRT needs both directions of every line");
  }
  const parsed = lines.map((line, i) => ({
    line,
    directions: [0, 1].map((d) =>
      extract(documents[i * 2 + d], line, line.relations[d]),
    ),
  }));

  for (const { line, directions } of parsed) {
    const [outbound, inbound] = directions;
    if (
      outbound.calls.map((c) => c.key).join() !== line.stations.join() ||
      inbound.calls.map((c) => c.key).join() !==
        [...line.stations].reverse().join()
    ) {
      throw new Error(`LRT ${line.id} directions must mirror each other`);
    }
  }

  // Every platform position per base name, across all lines and directions.
  const platforms = new Map<string, LngLat[]>();
  for (const { directions } of parsed) {
    for (const direction of directions) {
      for (const call of direction.calls) {
        platforms.set(call.key, [
          ...(platforms.get(call.key) ?? []),
          call.point,
        ]);
      }
    }
  }
  const centre = (key: string): LngLat => {
    const points = platforms.get(key)!;
    return [
      round(points.reduce((sum, p) => sum + p[0], 0) / points.length),
      round(points.reduce((sum, p) => sum + p[1], 0) / points.length),
    ];
  };

  const routes: RouteSummary[] = [];
  const details: RouteDetail[] = [];
  const stationByKey = new Map<
    string,
    {
      name: string;
      lat: number;
      lon: number;
      routes: string[];
      positions: Record<string, [number, number]>;
    }
  >();

  for (const { line, directions } of parsed) {
    const summary: RouteSummary = {
      route_id: line.id,
      route_short_name: line.id,
      route_long_name: line.longName,
      route_desc: line.desc,
      route_color: line.color,
      route_text_color: "FFFFFF",
    };
    const outbound = directions[0];
    const stops = outbound.calls.map((call, i) => {
      const [lon, lat] = centre(call.key);
      return {
        stop_id: `${line.id}${String(i + 1).padStart(2, "0")}`,
        stop_name: call.name,
        stop_lat: lat,
        stop_lon: lon,
        sequence: i + 1,
      };
    });
    const stopIds = new Map(
      outbound.calls.map((call, i) => [call.key, stops[i].stop_id]),
    );
    const variants = directions.map((direction, i) => ({
      trip_id: `${line.id}-${i}`,
      shape_id: `${line.id}-${i}`,
      direction_id: String(i),
      kind: "utama" as const,
      headsign: stops.find(
        (s) => s.stop_id === stopIds.get(direction.calls.at(-1)!.key),
      )!.stop_name,
      via: null,
      service_id: "OSM",
      headwaySecs: null,
      windows: [],
      stopCount: line.stations.length,
      extraStops: [],
      skippedStops: [],
      stopIds: direction.calls.map((call) => stopIds.get(call.key)!),
    }));
    const geometryByShape = Object.fromEntries(
      directions.map((direction, i) => {
        const start = projection(direction.line, direction.calls[0].point);
        const end = projection(direction.line, direction.calls.at(-1)!.point);
        const first = stops.find((s) => s.stop_id === variants[i].stopIds[0])!;
        const last = stops.find(
          (s) => s.stop_id === variants[i].stopIds.at(-1),
        )!;
        const coordinates: LngLat[] = [
          [first.stop_lon, first.stop_lat],
          ...direction.line.slice(start.segment + 1, end.segment + 1),
          [last.stop_lon, last.stop_lat],
        ];
        const shape = coordinates
          .map(([lon, lat]): LngLat => [round(lon), round(lat)])
          .filter((point, j, all) => !j || metres(point, all[j - 1]) > 0.01);
        return [variants[i].shape_id, shape];
      }),
    );
    routes.push(summary);
    details.push({ ...summary, stops, variants, geometryByShape });

    outbound.calls.forEach((call, i) => {
      const entry = stationByKey.get(call.key) ?? {
        name: call.name,
        lon: centre(call.key)[0],
        lat: centre(call.key)[1],
        routes: [],
        positions: {},
      };
      entry.routes.push(line.id);
      entry.positions[line.id] = [i + 1, line.stations.length];
      stationByKey.set(call.key, entry);
    });
  }

  const stations: StationIndexEntry[] = [...stationByKey.values()].map((s) => ({
    id: `${s.name}@${s.lat.toFixed(5)},${s.lon.toFixed(5)}`,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    platforms: 2,
    routes: [...s.routes].sort(),
    positions: s.positions,
  }));
  const stopLayer: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      properties: { name: s.name, routes: s.routes.length, stationId: s.id },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
  const overview: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: details.flatMap((detail) =>
      detail.variants.map((variant) => {
        const coordinates = detail.geometryByShape[variant.shape_id];
        // Display-only: the shared Dukuh Atas - Cawang trunk would otherwise
        // paint one line over the other. Baked geometry stays on the track.
        const lineOffset = railLineOffset(mode, detail.route_id, coordinates);
        return {
          type: "Feature" as const,
          properties: {
            color: `#${detail.route_color}`,
            opacity: 1,
            width: 3,
            ...(lineOffset ? { lineOffset } : {}),
          },
          geometry: { type: "LineString" as const, coordinates },
        };
      }),
    ),
  };
  return { routes, details, stations, stopLayer, overview };
}
