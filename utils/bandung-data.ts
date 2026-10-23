import type { FeatureCollection, LineString, Point } from "geojson";
import type {
  RouteDetail,
  RouteSummary,
  StationIndexEntry,
} from "./types/gtfs";
import {
  metres,
  round,
  STOP_ROLES,
  type LngLat,
  type OsmDocument,
  type OsmNode,
  type OsmRelation,
  type OsmWay,
} from "./rail-geometry";
import { BANDUNG_ANGKOT_LINES } from "./bandung-angkot";

export interface BandungLine {
  id: string;
  name: string;
  color: string;
  kind: "train" | "bus";
  /** Each OSM relation represents one operating direction or short-run variant. */
  relations: readonly number[];
  /** Only served stations, in geographic order. Used to reject silent OSM edits. */
  stations?: readonly string[];
  /** OSM `network` tag. Defaults to the operator implied by `kind` and `id`. */
  network?: string;
  /** OSM `ref` values for this line, when they are not simply `id`. */
  refs?: readonly string[];
  /** `route_desc` shown in the app. Defaults to the operator label. */
  service?: string;
  /** Short badge text when the id is too long to render (angkot corridors). */
  short?: string;
  /** Accept any OSM network value; angkot uses two different network tags. */
  anyNetwork?: boolean;
}
export const BANDUNG_SYSTEMS = {
  "bdg-kci": [
    {
      id: "B",
      name: "Padalarang - Cicalengka",
      color: "2D398B",
      kind: "train",
      relations: [17077466, 17077467],
      stations: [
        "Padalarang",
        "Gadobangkong",
        "Cimahi",
        "Cimindi",
        "Ciroyom",
        "Bandung",
        "Cikudapateuh",
        "Kiaracondong",
        "Gedebage",
        "Cimekar",
        "Rancaekek",
        "Haurpugur",
        "Cicalengka",
      ],
    },
    {
      id: "C",
      name: "Purwakarta - Garut",
      color: "1C75BC",
      kind: "train",
      relations: [15534571, 17545520, 17549847, 17549848, 17549850],
      stations: [
        "Purwakarta",
        "Ciganea",
        "Sukatani",
        "Plered",
        "Cikadongdong",
        "Rendeh",
        "Maswati",
        "Sasaksaat",
        "Cilame",
        "Padalarang",
        "Gadobangkong",
        "Cimahi",
        "Cimindi",
        "Ciroyom",
        "Bandung",
        "Cikudapateuh",
        "Kiaracondong",
        "Gedebage",
        "Cimekar",
        "Rancaekek",
        "Haurpugur",
        "Cicalengka",
        "Nagreg",
        "Leles",
        "Karangsari",
        "Leuwigoong",
        "Cibatu",
        "Pasirjengkol",
        "Wanaraja",
        "Garut",
      ],
    },
  ],
  "bdg-kai": [
    {
      id: "KC",
      name: "Bandung - Padalarang",
      color: "A30028",
      kind: "train",
      relations: [17571086, 17571085],
      stations: ["Bandung", "Cimahi", "Padalarang"],
    },
  ],
  "bdg-mjt": [
    {
      id: "1",
      name: "Leuwipanjang - Soreang",
      color: "00A64F",
      kind: "bus",
      relations: [14365267, 18765871],
    },
    {
      id: "2",
      name: "Alun-alun Bandung - Kota Baru Parahyangan",
      color: "ED1C24",
      kind: "bus",
      relations: [18766205, 18766206],
    },
    {
      id: "3",
      name: "BEC - Baleendah",
      color: "562B63",
      kind: "bus",
      relations: [18766207, 18766208],
    },
    {
      id: "4",
      name: "Leuwipanjang - Dago",
      color: "2E3192",
      kind: "bus",
      relations: [14298213, 18770906],
    },
    {
      id: "5",
      name: "Jatinangor - Dipatiukur",
      color: "EC008C",
      kind: "bus",
      relations: [14364569, 15660998],
    },
    {
      id: "6",
      name: "Leuwipanjang - Majalaya",
      color: "F04B23",
      kind: "bus",
      relations: [18771078, 18771079],
    },
    {
      id: "FD1",
      name: "Simpang Soetta Kiaracondong - Pasar Baru ABC",
      color: "22B473",
      kind: "bus",
      relations: [19664371, 19664372],
    },
    {
      id: "FD2",
      name: "Elang - Cicadas",
      color: "C0282C",
      kind: "bus",
      relations: [19757704, 19757705],
    },
  ],
  // Neither operator publishes per-corridor hex codes, so these are a display
  // palette: one distinct hue per corridor, not an official livery colour.
  "bdg-tmb": [
    {
      id: "K1",
      name: "Cibiru - Cibeureum",
      color: "D71920",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung \u00b7 Dishub Kota Bandung",
      relations: [18768804, 18768805],
    },
    {
      id: "K2",
      name: "Cicaheum - Cibeureum",
      color: "F26522",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung \u00b7 Dishub Kota Bandung",
      relations: [15520324, 17329177],
    },
    {
      id: "K3",
      name: "Cicaheum - Sarijadi",
      color: "FDB913",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung \u00b7 Dishub Kota Bandung",
      relations: [17564612, 17564831],
    },
    {
      id: "K4",
      name: "Antapani - Leuwipanjang",
      color: "00A651",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung \u00b7 Dishub Kota Bandung",
      relations: [15555901, 17770945],
    },
    {
      id: "K5",
      name: "Antapani - Stasiun Hall",
      color: "0072BC",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung \u00b7 Dishub Kota Bandung",
      relations: [15555900, 17350725],
    },
    {
      id: "F1",
      name: "Stasiun Hall - Gunung Batu",
      color: "8A2BE2",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung feeder \u00b7 Dishub Kota Bandung",
      relations: [17772446, 17772447],
    },
    {
      id: "F2",
      name: "Summarecon Mall - Cibeureum",
      color: "A0522D",
      kind: "bus",
      network: "Trans Metro Bandung",
      service: "Trans Metro Bandung feeder \u00b7 Dishub Kota Bandung",
      relations: [17771075, 17772429],
    },
  ],
  "bdg-damri": [
    {
      id: "2",
      name: "Leuwipanjang - Ledeng",
      color: "00539F",
      kind: "bus",
      network: "Bus Kota Damri",
      refs: ["DAMRI 2"],
      service: "Bus Kota DAMRI \u00b7 Perum DAMRI",
      relations: [17771220, 17771221],
    },
    {
      id: "6A",
      name: "Elang - Jatinangor",
      color: "00AEEF",
      kind: "bus",
      network: "Bus Kota Damri",
      refs: ["6A", "DAMRI 6A"],
      service: "Bus Kota DAMRI \u00b7 Perum DAMRI",
      relations: [17771076, 17772430],
    },
    {
      id: "8",
      name: "Tanjungsari - Kebon Kelapa",
      color: "1B5EAA",
      kind: "bus",
      network: "Bus Kota Damri",
      refs: ["DAMRI 8"],
      service: "Bus Kota DAMRI \u00b7 Perum DAMRI",
      relations: [17565369, 17771073],
    },
    {
      id: "11",
      name: "Leuwipanjang - Cibiru",
      color: "3AA6DD",
      kind: "bus",
      network: "Bus Kota Damri",
      refs: ["DAMRI 11"],
      service: "Bus Kota DAMRI \u00b7 Perum DAMRI",
      relations: [17771219, 17771223],
    },
    {
      id: "KBP",
      name: "Alun-alun Bandung - Kota Baru Parahyangan",
      color: "0F3D6E",
      kind: "bus",
      network: "Bus Kota Damri",
      refs: ["KBP"],
      service: "Bus Kota DAMRI \u00b7 Perum DAMRI",
      relations: [18771222, 18771223],
    },
  ],
  // Generated from a validated OSM scan; see utils/bandung-angkot.ts.
  "bdg-angkot": BANDUNG_ANGKOT_LINES,
} as const satisfies Record<string, readonly BandungLine[]>;
export type BandungSystem = keyof typeof BANDUNG_SYSTEMS;

interface Call {
  name: string;
  point: LngLat;
}
interface Direction {
  calls: Call[];
  track: LngLat[];
}

/** OSM PTv2 route member order is the order actually travelled. Unlike a
 * railway chain, bus ways may form loops: use shared node IDs, not proximity
 * or a shortest-path guess that might take the wrong side of a one-way road. */
function extract(doc: OsmDocument, line: BandungLine, id: number): Direction {
  const nodes = new Map(
    doc.elements
      .filter((e): e is OsmNode => e.type === "node")
      .map((n) => [n.id, n]),
  );
  const ways = new Map(
    doc.elements
      .filter((e): e is OsmWay => e.type === "way")
      .map((w) => [w.id, w]),
  );
  const relation = doc.elements.find(
    (e): e is OsmRelation => e.type === "relation" && e.id === id,
  );
  const network =
    line.network ??
    (line.kind === "bus"
      ? "Metro Jabar Trans"
      : line.id === "KC"
        ? "KAI"
        : "KAI Commuter");
  const refs = line.refs ?? [line.id];
  if (
    !relation ||
    relation.tags?.route !== line.kind ||
    (!line.anyNetwork && relation.tags?.network !== network) ||
    !refs.includes(relation.tags?.ref ?? "")
  ) {
    throw new Error(`Bandung relation ${id} no longer matches ${line.id}`);
  }
  // Some routes tag the name on the neighbouring platform and leave the
  // stop_position itself unnamed. Use that platform's name; drop a stop only
  // when nothing nearby names it, and say so.
  const namedPlatforms = relation.members
    .filter((m) => m.type === "node" && m.role === "platform")
    .map((m) => nodes.get(m.ref))
    .filter((n): n is OsmNode => Boolean(n?.tags?.name));
  const calls: Call[] = [];
  for (const m of relation.members) {
    if (m.type !== "node" || !STOP_ROLES.has(m.role)) continue;
    const node = nodes.get(m.ref);
    if (!node) throw new Error(`${id} missing stop node ${m.ref}`);
    let name = node.tags?.name?.trim();
    if (!name) {
      const nearest = namedPlatforms
        .map((n) => ({
          name: n.tags!.name!,
          distance: metres([n.lon, n.lat], [node.lon, node.lat]),
        }))
        .filter((n) => n.distance < 60)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) {
        console.warn(`  ! ${id} drops unnamed stop ${m.ref} with no platform`);
        continue;
      }
      name = nearest.name;
    }
    calls.push({ name, point: [node.lon, node.lat] as LngLat });
  }
  if (calls.length < 2 || calls.some((c) => !c.name.trim()))
    throw new Error(`${id} has missing stops`);
  if (line.stations) {
    const indices = calls.map((c) => line.stations!.indexOf(c.name));
    if (
      indices.includes(-1) ||
      !indices.every((v, i) => !i || Math.abs(v - indices[i - 1]) === 1)
    ) {
      throw new Error(
        `${id} passenger station order differs from validated ${line.id} list`,
      );
    }
  }
  const declared = relation.members.filter((m) => m.type === "way");
  /** Walk the member ways in their declared order, joining shared nodes. */
  const walk = (members: typeof declared): number[] => {
  const sequence: number[] = [];
  for (let k = 0; k < members.length; k++) {
    const way = ways.get(members[k].ref);
    if (
      !way ||
      (line.kind === "train"
        ? way.tags?.railway !== "rail"
        : !way.tags?.highway)
    )
      throw new Error(`${id} missing operating track/road ${members[k].ref}`);
    let segment = [...way.nodes];
    if (k === 0) {
      const next = ways.get(members[1]?.ref)?.nodes ?? [];
      if (next.includes(segment[0]) && !next.includes(segment.at(-1)!))
        segment.reverse();
      sequence.push(...segment);
      continue;
    }
    const end = sequence.at(-1)!;
    if (segment[0] === segment.at(-1) && segment.includes(end)) {
      // A roundabout is a closed way. Exit at its shared node with the next member.
      const next = ways.get(members[k + 1]?.ref)?.nodes ?? [];
      const ring = segment.slice(0, -1);
      const start = ring.indexOf(end);
      let exit = -1;
      for (let j = 1; j <= ring.length; j++) {
        const node = ring[(start + j) % ring.length];
        if (next.includes(node)) {
          exit = j;
          break;
        }
      }
      if (exit < 0) throw new Error(`${id} roundabout ${way.id} has no exit`);
      for (let j = 1; j <= exit; j++)
        sequence.push(ring[(start + j) % ring.length]);
    } else if (segment[0] === end) sequence.push(...segment.slice(1));
    else if (segment.at(-1) === end)
      sequence.push(...segment.reverse().slice(1));
    else throw new Error(`${id} disconnected at way ${way.id}`);
  }
  return sequence;
  };
  /**
   * Some bus relations list their ways out of travel order. That is a mapping
   * detail, not a data defect, so fall back to joining ways by shared endpoint
   * nodes in member order. No geometry is invented: every way still comes from
   * the relation, and a chain that cannot be completed still throws.
   */
  const reorderBySharedNodes = (members: typeof declared) => {
    const pool = members.map((m) => ({ member: m, nodes: [...(ways.get(m.ref)?.nodes ?? [])] }));
    if (pool.some((p) => p.nodes.length < 2)) return null;
    const order = [pool.shift()!];
    let tailNode = order[0].nodes.at(-1)!;
    while (pool.length) {
      const next = pool.findIndex(
        (p) => p.nodes[0] === tailNode || p.nodes.at(-1) === tailNode,
      );
      if (next < 0) return null;
      const [candidate] = pool.splice(next, 1);
      if (candidate.nodes[0] !== tailNode) candidate.nodes.reverse();
      tailNode = candidate.nodes.at(-1)!;
      order.push(candidate);
    }
    return order.map((p) => p.member);
  };
  let members = declared;
  let sequence: number[];
  try {
    sequence = walk(members);
  } catch (error) {
    const reordered = reorderBySharedNodes(declared);
    if (!reordered) throw error;
    members = reordered;
    sequence = walk(members);
  }
  if (!sequence.length) throw new Error(`${id} has no geometry`);
  const positions = relation.members
    .filter((m) => m.type === "node" && STOP_ROLES.has(m.role))
    .map((m) => sequence.indexOf(m.ref));
  if (
    positions.some((n) => n < 0) ||
    positions.some((n, i) => i > 0 && n <= positions[i - 1])
  )
    throw new Error(`${id} stops are off-track or out of order`);
  const track = sequence
    .slice(positions[0], positions.at(-1)! + 1)
    .map((n): LngLat => {
      const node = nodes.get(n);
      if (!node) throw new Error(`${id} missing track node ${n}`);
      return [round(node.lon), round(node.lat)];
    });
  if (track.length < 2) throw new Error(`${id} has an empty line`);
  return { calls, track };
}

function busKey(call: Call): string {
  // Direction-specific stop positions normally have an A/B suffix. Preserve
  // the real stop name in route detail; combine only nearby opposite platforms.
  return call.name
    .replace(/\s+[AB]$/, "")
    .trim()
    .toLowerCase();
}
export function bakeBandung(
  documents: OsmDocument[],
  lines: readonly BandungLine[],
) {
  if (
    !lines.length ||
    documents.length !== lines.reduce((n, l) => n + l.relations.length, 0)
  )
    throw new Error("Missing Bandung relations");
  const parsed: { config: BandungLine; directions: Direction[] }[] = [];
  let cursor = 0;
  for (const config of lines) {
    parsed.push({
      config,
      directions: config.relations.map((id) =>
        extract(documents[cursor++], config, id),
      ),
    });
  }
  // Same physical rail station across lines, but buses use a small-distance
  // gate so repeated street names in different neighbourhoods stay separate.
  const points = new Map<string, LngLat[]>();
  for (const { config, directions } of parsed)
    for (const dir of directions)
      for (const call of dir.calls) {
        if (config.kind !== "train") continue;
        const key = call.name.toLowerCase();
        points.set(key, [...(points.get(key) ?? []), call.point]);
      }
  const centre = (call: Call, kind: BandungLine["kind"]): LngLat => {
    if (kind === "bus") return call.point; // Do not move roadside stops off their route.
    const pts = points.get(call.name.toLowerCase())!;
    return [
      round(pts.reduce((n, p) => n + p[0], 0) / pts.length),
      round(pts.reduce((n, p) => n + p[1], 0) / pts.length),
    ];
  };
  const routes: RouteSummary[] = [];
  const details: RouteDetail[] = [];
  const stations: StationIndexEntry[] = [];
  const stopFor = (call: Call, config: BandungLine): StationIndexEntry => {
    const [lon, lat] = centre(call, config.kind);
    if (config.kind === "train") {
      const existing = stations.find((s) => s.name === call.name);
      if (existing) return existing;
    } else {
      const key = busKey(call);
      const existing = stations.find(
        (s) =>
          busKey({ name: s.name, point: [s.lon, s.lat] }) === key &&
          metres([s.lon, s.lat], [lon, lat]) < 85,
      );
      if (existing) return existing;
    }
    const s: StationIndexEntry = {
      id: `${call.name}@${lat.toFixed(5)},${lon.toFixed(5)}`,
      name: call.name,
      lon,
      lat,
      platforms: 1,
      routes: [],
      positions: {},
    };
    stations.push(s);
    return s;
  };
  for (const { config, directions } of parsed) {
    const summary: RouteSummary = {
      route_id: config.id,
      route_short_name: config.short ?? config.id,
      route_long_name: config.name,
      route_desc:
        config.service ??
        (config.kind === "bus"
          ? "Metro Jabar Trans"
          : config.id === "KC"
            ? "KA Feeder Whoosh \u00b7 PT KAI"
            : "Commuter Line \u00b7 KAI Commuter"),
      route_color: config.color,
      route_text_color: "FFFFFF",
    };
    routes.push(summary);
    const byStation = new Map<string, ReturnType<typeof stopFor>>();
    for (const dir of directions)
      for (const call of dir.calls) {
        const s = stopFor(call, config);
        byStation.set(s.id, s);
      }
    // The primary direction's stops come first, followed by return-only ones.
    const ordered = [
      ...new Map(
        directions.flatMap((d) =>
          d.calls.map((c) => {
            const s = stopFor(c, config);
            return [s.id, s] as const;
          }),
        ),
      ).values(),
    ];
    const stops = ordered.map((s, i) => ({
      stop_id: `${config.id}-${String(i + 1).padStart(3, "0")}`,
      stop_name: s.name,
      stop_lat: s.lat,
      stop_lon: s.lon,
      sequence: i + 1,
    }));
    const idFor = new Map(ordered.map((s, i) => [s.id, stops[i].stop_id]));
    const variants = directions.map((d, i) => {
      const stopIds = d.calls.map((c) => idFor.get(stopFor(c, config).id)!);
      return {
        trip_id: `${config.id}-${i}`,
        shape_id: `${config.id}-${i}`,
        direction_id: String(i),
        kind: i < 2 ? ("utama" as const) : ("pendek" as const),
        headsign: d.calls.at(-1)!.name,
        via: null,
        service_id: "OSM",
        headwaySecs: null,
        windows: [],
        stopCount: stopIds.length,
        extraStops: [],
        skippedStops: [],
        stopIds,
      };
    });
    // Keep geometry on the mapped track/road; do not invent a bridge between
    // opposing platforms, and do not invent schedules from OSM relations.
    const geometryByShape = Object.fromEntries(
      directions.map((d, i) => [variants[i].shape_id, d.track]),
    );
    details.push({ ...summary, stops, variants, geometryByShape });
    for (const [sId, s] of byStation) {
      if (!s.routes.includes(config.id)) s.routes.push(config.id);
      s.positions[config.id] = [
        ordered.findIndex((v) => v.id === sId) + 1,
        ordered.length,
      ];
    }
  }
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
    features: details.flatMap((d) =>
      d.variants.map((v) => ({
        type: "Feature" as const,
        properties: { color: `#${d.route_color}` },
        geometry: {
          type: "LineString" as const,
          coordinates: d.geometryByShape[v.shape_id],
        },
      })),
    ),
  };
  return { routes, details, stations, stopLayer, overview };
}
