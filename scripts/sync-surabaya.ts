/**
 * Bake the approved Surabaya OSM route relations into three standalone data
 * sets. Run with: npx tsx scripts/sync-surabaya.ts
 *
 * OSM supplies geometry, stop members and OSM service-hour tags only. This
 * baker never derives a timetable or headway from the route relations.
 */

import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration

const OSM_API = "https://api.openstreetmap.org/api/0.6";
const USER_AGENT = "transum-app-surabaya-sync/1.0";
const CACHE_DIR = path.join(process.cwd(), ".scratch", "osm");
const DATA_ROOT = path.join(process.cwd(), "data");
const STOP_ROLES = new Set([
  "stop",
  "stop_entry_only",
  "stop_exit_only",
]);
const BUS_JOIN_GAP_M = 30;
const BUS_FALLBACK_GAP_M = 100;

const PLATFORM_ROLES = new Set([
  "platform",
  "platform_entry_only",
  "platform_exit_only",
]);

interface LineConfig {
  id: string;
  name: string;
  color: string;
  kind: "train" | "bus";
  network: string;
  operator: string;
  relations: readonly number[];
  /** Suroboyo's approved counts are the ordinary `platform` members only. */
  stopRoles?: ReadonlySet<string>;
  stopsPartial?: boolean;
  provincial?: boolean;
  unverified?: boolean;
  scope: string;
}

const KAI_LINES: readonly LineConfig[] = [
  {
    id: "A",
    name: "Sidoarjo - Bojonegoro",
    color: "412664",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18308008, 18308009],
    scope: "KAI Commuter Area VIII Arjonegoro",
  },
  {
    id: "B",
    name: "Surabaya Pasarturi - Cepu",
    color: "414495",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18306828, 18306829],
    scope: "KAI Commuter Area VIII Blorasura",
  },
  {
    id: "D",
    name: "Surabaya Kota - Blitar via Kertosono",
    color: "729B6B",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18068767, 18068768],
    scope: "KAI Commuter Area VIII Dhoho",
  },
  {
    id: "J",
    name: "Surabaya Kota - Mojokerto",
    color: "2B52A3",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18082351, 18082352],
    scope: "KAI Commuter Area VIII Jenggala",
  },
  {
    id: "P",
    name: "Surabaya Kota - Blitar via Malang",
    color: "00A53A",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18099420, 18099421],
    scope: "KAI Commuter Area VIII Penataran",
  },
  {
    id: "SI",
    name: "Sidoarjo - Indro via Surabaya",
    // Distinct display colour; this service is intentionally marked
    // unverified because it is absent from KAI Commuter's published list.
    color: "B64B8A",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [17532039, 18312633],
    unverified: true,
    scope: "KAI Commuter Area VIII Sindro (unverified service)",
  },
  {
    id: "SP",
    name: "Surabaya Kota - Pasuruan",
    color: "69C3B2",
    kind: "train",
    network: "KAI Commuter",
    operator: "KAI Commuter",
    relations: [18329868, 18329869],
    scope: "KAI Commuter Area VIII Supas",
  },
];

const SUROBOYO_LINES: readonly LineConfig[] = [
  {
    id: "R1",
    name: "Terminal Purabaya - Rajawali",
    color: "C8102E",
    kind: "bus",
    network: "Bus Suroboyo",
    operator: "Dinas Perhubungan Kota Surabaya",
    relations: [9788759, 9788760],
    // The approved R1 counts are 21 and 23 ordinary platform members. The
    // entry/exit-only terminal members are relation metadata, not calls in
    // this route's stop sequence.
    stopRoles: new Set(["platform"]),
    stopsPartial: false,
    scope: "Suroboyo Bus R1; OSM platform sequence is complete",
  },
  {
    id: "2",
    name: "ITS - Unesa",
    color: "F2A900",
    kind: "bus",
    network: "Bus Suroboyo",
    operator: "Dinas Perhubungan Kota Surabaya",
    relations: [9788971, 9788972],
    stopRoles: new Set(["platform"]),
    stopsPartial: true,
    scope: "Suroboyo Bus route 2; OSM stop data is partial",
  },
  {
    id: "3",
    name: "Alun-Alun Contong - Terminal Purabaya",
    color: "00843D",
    kind: "bus",
    network: "Bus Suroboyo",
    operator: "Dinas Perhubungan Kota Surabaya",
    relations: [9789001, 9789002],
    stopRoles: new Set(["platform"]),
    stopsPartial: true,
    scope: "Suroboyo Bus route 3; OSM stop data is partial",
  },
  {
    id: "4",
    name: "Gunung Anyar - Kenjeran",
    color: "0057B8",
    kind: "bus",
    network: "Bus Suroboyo",
    operator: "Dinas Perhubungan Kota Surabaya",
    relations: [9969904, 9969905],
    stopRoles: new Set(["platform"]),
    stopsPartial: true,
    scope: "Suroboyo Bus route 4; OSM stop data is partial",
  },
  {
    id: "5",
    name: "Yono Suwoyo - Joyoboyo",
    color: "7A5EA8",
    kind: "bus",
    network: "Bus Suroboyo",
    operator: "Dinas Perhubungan Kota Surabaya",
    relations: [13130304, 13130305],
    stopRoles: new Set(["platform"]),
    stopsPartial: true,
    scope: "Suroboyo Bus route 5; OSM stop data is partial",
  },
];

const TRANSJATIM_LINES: readonly LineConfig[] = [
  {
    id: "K1",
    name: "Terminal Porong - Terminal Bunder",
    color: "E4002B",
    kind: "bus",
    network: "Trans Jatim",
    operator: "Trans Jatim",
    relations: [17520665],
    // Trans Jatim's entry and exit platforms are real terminal calls. Unlike
    // the approved Suroboyo counts, keep all platform role variants here.
    stopRoles: PLATFORM_ROLES,
    provincial: true,
    scope: "Trans Jatim provincial corridor K1",
  },
  {
    id: "K2",
    name: "Terminal Kertajaya - Dukuh Menanggal",
    color: "FDB913",
    kind: "bus",
    network: "Trans Jatim",
    operator: "Trans Jatim",
    relations: [17519350],
    stopRoles: PLATFORM_ROLES,
    provincial: true,
    scope: "Trans Jatim provincial corridor K2",
  },
  {
    id: "K3",
    name: "Terminal Kertajaya - Terminal Bunder",
    color: "007A33",
    kind: "bus",
    network: "Trans Jatim",
    operator: "Trans Jatim",
    relations: [17518647],
    stopRoles: PLATFORM_ROLES,
    provincial: true,
    scope: "Trans Jatim provincial corridor K3",
  },
];

const SYSTEMS = {
  "sby-kai": KAI_LINES,
  "sby-suroboyo": SUROBOYO_LINES,
  "sby-transjatim": TRANSJATIM_LINES,
} as const;
type Mode = keyof typeof SYSTEMS;

const EXCLUDED_TUMAPEL = [18320740, 18320741] as const;

// ---------------------------------------------------------------------------
// OSM types and cached HTTP

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  timestamp?: string;
  tags?: Record<string, string>;
}

interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  timestamp?: string;
  tags?: Record<string, string>;
}

interface OsmMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
}

interface OsmRelation {
  type: "relation";
  id: number;
  members: OsmMember[];
  timestamp?: string;
  tags?: Record<string, string>;
}

interface OsmDocument {
  version?: number;
  elements: Array<OsmNode | OsmWay | OsmRelation>;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function cachePath(id: number) {
  return path.join(CACHE_DIR, `relation-${id}.full.json`);
}

async function readCachedRelation(id: number): Promise<OsmDocument | null> {
  try {
    const raw = await fs.readFile(cachePath(id), "utf8");
    const parsed = JSON.parse(raw) as OsmDocument;
    if (!Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchRelation(id: number): Promise<OsmDocument> {
  const cached = await readCachedRelation(id);
  if (cached) {
    console.log(`  cache relation ${id}`);
    return cached;
  }

  const url = `${OSM_API}/relation/${id}/full.json`;
  let lastError = "unknown error";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      const parsed = JSON.parse(text) as OsmDocument;
      if (!Array.isArray(parsed.elements)) throw new Error("response has no elements");
      await fs.mkdir(CACHE_DIR, { recursive: true });
      // Keep the successful response body as the re-run cache. It is written
      // exactly as received rather than regenerated from the parsed object.
      await fs.writeFile(cachePath(id), text);
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await sleep(1500 * 2 ** attempt);
    }
  }
  throw new Error(`${url} failed after 4 attempts (${lastError})`);
}

function relationOf(doc: OsmDocument, id: number): OsmRelation {
  const relation = doc.elements.find(
    (element): element is OsmRelation =>
      element.type === "relation" && element.id === id,
  );
  if (!relation) throw new Error(`Relation ${id}: full response did not contain the relation`);
  return relation;
}

function nodesOf(doc: OsmDocument) {
  return new Map(
    doc.elements
      .filter((element): element is OsmNode => element.type === "node")
      .map((node) => [node.id, node]),
  );
}

function waysOf(doc: OsmDocument) {
  return new Map(
    doc.elements
      .filter((element): element is OsmWay => element.type === "way")
      .map((way) => [way.id, way]),
  );
}

function latestOsmTimestamp(doc: OsmDocument): string | null {
  const relationTimestamps = doc.elements
    .filter((element): element is OsmRelation => element.type === "relation")
    .map((relation) => relation.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp));
  if (relationTimestamps.length) return relationTimestamps.sort().at(-1)!;
  const timestamps = doc.elements
    .map((element) => element.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp));
  return timestamps.length ? timestamps.sort().at(-1)! : null;
}

// ---------------------------------------------------------------------------
// Geometry and stop extraction

type LngLat = [number, number];

const metres = (a: LngLat, b: LngLat) =>
  Math.hypot(
    (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
    (a[1] - b[1]) * 110_540,
  );

const round = (n: number) => Number(n.toFixed(7));

function validPoint(point: LngLat) {
  return (
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= -180 &&
    point[0] <= 180 &&
    point[1] >= -90 &&
    point[1] <= 90
  );
}

function dedupeLine(line: LngLat[]): LngLat[] {
  return line.filter(
    (point, index) => index === 0 || metres(point, line[index - 1]) > 0.01,
  );
}

function assertGeometry(id: number, line: LngLat[]) {
  if (line.length < 2) throw new Error(`Relation ${id}: geometry has fewer than two points`);
  if (line.some((point) => !validPoint(point))) {
    throw new Error(`Relation ${id}: geometry contains an invalid coordinate`);
  }
  if (line.every((point, index) => index === 0 || metres(point, line[index - 1]) <= 0.01)) {
    throw new Error(`Relation ${id}: geometry has zero length`);
  }
}

function pointForNode(nodes: Map<number, OsmNode>, id: number, context: string): LngLat {
  const node = nodes.get(id);
  if (!node) throw new Error(`${context}: missing node ${id}`);
  const point: LngLat = [node.lon, node.lat];
  if (!validPoint(point)) throw new Error(`${context}: node ${id} has an invalid coordinate`);
  return point;
}

function stopMembers(relation: OsmRelation, roles: ReadonlySet<string>) {
  return relation.members.filter(
    (member) => member.type === "node" && roles.has(member.role),
  );
}

interface Call {
  nodeId: number;
  name: string;
  point: LngLat;
  role: string;
}

function callName(
  member: OsmMember,
  nodes: Map<number, OsmNode>,
  namedPlatforms: OsmNode[],
  relationId: number,
): string {
  const node = nodes.get(member.ref);
  if (!node) throw new Error(`Relation ${relationId}: missing stop node ${member.ref}`);
  const direct = node.tags?.name?.trim();
  if (direct) return direct;

  const nearest = namedPlatforms
    .map((platform) => ({
      name: platform.tags!.name!.trim(),
      distance: metres([platform.lon, platform.lat], [node.lon, node.lat]),
    }))
    .filter((candidate) => candidate.distance <= 60)
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest) return nearest.name;

  throw new Error(
    `Relation ${relationId}: stop node ${member.ref} is unnamed and has no named platform fallback`,
  );
}

function extractCalls(
  relation: OsmRelation,
  nodes: Map<number, OsmNode>,
  roles: ReadonlySet<string>,
): Call[] {
  const namedPlatforms = relation.members
    .filter((member) => member.type === "node" && PLATFORM_ROLES.has(member.role))
    .map((member) => nodes.get(member.ref))
    .filter((node): node is OsmNode => Boolean(node?.tags?.name?.trim()));

  return stopMembers(relation, roles).map((member) => {
    const node = nodes.get(member.ref);
    if (!node) throw new Error(`Relation ${relation.id}: missing stop node ${member.ref}`);
    return {
      nodeId: node.id,
      name: callName(member, nodes, namedPlatforms, relation.id),
      point: [node.lon, node.lat] as LngLat,
      role: member.role,
    };
  });
}

function projection(line: LngLat[], point: LngLat) {
  let best = { along: 0, distance: Infinity, point: line[0] };
  let walked = 0;
  for (let index = 0; index + 1 < line.length; index++) {
    const a = line[index];
    const b = line[index + 1];
    const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * kx;
    const py = (point[1] - a[1]) * 110_540;
    const length = Math.hypot(dx, dy);
    const t = length
      ? Math.max(0, Math.min(1, (px * dx + py * dy) / (length * length)))
      : 0;
    const distance = Math.hypot(px - dx * t, py - dy * t);
    if (distance < best.distance) {
      best = {
        along: walked + length * t,
        distance,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      };
    }
    walked += length;
  }
  return best;
}

function orientToCalls(line: LngLat[], calls: Call[]): LngLat[] {
  if (calls.length < 2) return line;
  const first = projection(line, calls[0].point).along;
  const last = projection(line, calls.at(-1)!.point).along;
  return first <= last ? line : [...line].reverse();
}

function validateCalls(
  relationId: number,
  line: LngLat[],
  calls: Call[],
  maxOffTrackM: number,
) {
  if (!calls.length) throw new Error(`Relation ${relationId}: no stop members`);
  const placed = calls.map((call) => ({ call, hit: projection(line, call.point) }));
  for (const { call, hit } of placed) {
    if (hit.distance > maxOffTrackM) {
      throw new Error(
        `Relation ${relationId}: stop ${call.name} is ${hit.distance.toFixed(1)}m off the route chain (limit ${maxOffTrackM}m)`,
      );
    }
  }
  for (let index = 1; index < placed.length; index++) {
    if (placed[index].hit.along <= placed[index - 1].hit.along + 0.01) {
      throw new Error(
        `Relation ${relationId}: stops ${placed[index - 1].call.name} -> ${placed[index].call.name} are out of route order`,
      );
    }
  }
}

function nodePoints(
  way: OsmWay,
  nodes: Map<number, OsmNode>,
  relationId: number,
): LngLat[] {
  if (way.nodes.length < 2) {
    throw new Error(`Relation ${relationId}: way ${way.id} has fewer than two nodes`);
  }
  return way.nodes.map((nodeId) =>
    pointForNode(nodes, nodeId, `Relation ${relationId} way ${way.id}`),
  );
}

/**
 * Rail is deliberately stricter than bus: relation way members must remain
 * in their declared order and every member must attach to the previous member
 * at the exact shared endpoint node. Reversing a member is orientation, not a
 * geometry shortcut; no gap is bridged.
 */
function chainRail(
  relation: OsmRelation,
  ways: Map<number, OsmWay>,
  nodes: Map<number, OsmNode>,
  calls: Call[],
): LngLat[] {
  const members = relation.members.filter((member) => member.type === "way");
  if (!members.length) throw new Error(`Relation ${relation.id}: no rail way members`);

  const segments = members.map((member) => {
    const way = ways.get(member.ref);
    if (!way) throw new Error(`Relation ${relation.id}: missing way ${member.ref}`);
    if (way.tags?.railway !== "rail") {
      throw new Error(
        `Relation ${relation.id}: way ${way.id} is not operating rail track`,
      );
    }
    return { way, nodes: [...way.nodes], points: nodePoints(way, nodes, relation.id) };
  });

  const firstStop = calls[0]?.point;
  if (!firstStop) throw new Error(`Relation ${relation.id}: no rail stop members`);
  if (
    metres(segments[0].points[0], firstStop) <=
    metres(segments[0].points.at(-1)!, firstStop)
  ) {
    // keep orientation
  } else {
    segments[0].nodes.reverse();
    segments[0].points.reverse();
  }

  const sequence = [...segments[0].nodes];
  const line = [...segments[0].points];
  for (const segment of segments.slice(1)) {
    const tail = sequence.at(-1)!;
    if (segment.nodes[0] === tail) {
      sequence.push(...segment.nodes.slice(1));
      line.push(...segment.points.slice(1));
    } else if (segment.nodes.at(-1) === tail) {
      segment.nodes.reverse();
      segment.points.reverse();
      sequence.push(...segment.nodes.slice(1));
      line.push(...segment.points.slice(1));
    } else {
      throw new Error(
        `Relation ${relation.id}: rail way ${segment.way.id} does not attach endpoint-to-endpoint after way ${sequence.length ? sequence.at(-1) : "start"}`,
      );
    }
  }

  const cleaned = dedupeLine(line);
  assertGeometry(relation.id, cleaned);
  return cleaned;
}

/** Same declared-order walk plus the Bandung greedy shared-node fallback. */
function chainBus(
  relation: OsmRelation,
  ways: Map<number, OsmWay>,
  nodes: Map<number, OsmNode>,
): LngLat[] {
  const declared = relation.members.filter((member) => member.type === "way");
  if (!declared.length) throw new Error(`Relation ${relation.id}: no bus way members`);

  const walk = (members: OsmMember[]): LngLat[] => {
    const sequence: number[] = [];
    const line: LngLat[] = [];
    for (let index = 0; index < members.length; index++) {
      const way = ways.get(members[index].ref);
      if (!way || !way.tags?.highway) {
        throw new Error(
          `Relation ${relation.id}: missing operating road ${members[index].ref}`,
        );
      }
      let segment = [...way.nodes];
      if (segment.length < 2) {
        throw new Error(`Relation ${relation.id}: way ${way.id} has fewer than two nodes`);
      }
        if (index === 0) {
        const next = ways.get(members[index + 1]?.ref)?.nodes ?? [];
        if (next.includes(segment[0]) && !next.includes(segment.at(-1)!)) {
          segment.reverse();
        }
        sequence.push(...segment);
        const points = nodePoints(way, nodes, relation.id);
        if (segment[0] === way.nodes[0]) line.push(...points);
        else line.push(...points.reverse());
        continue;
      }

      const end = sequence.at(-1)!;
      if (segment[0] === segment.at(-1) && segment.includes(end)) {
        // A roundabout is a closed way. Exit at the shared node with the next
        // member instead of drawing the ring twice.
        const next = ways.get(members[index + 1]?.ref)?.nodes ?? [];
        const ring = segment.slice(0, -1);
        const start = ring.indexOf(end);
        let exit = -1;
        for (let step = 1; step <= ring.length; step++) {
          const node = ring[(start + step) % ring.length];
          if (next.includes(node)) {
            exit = step;
            break;
          }
        }
        if (exit < 0) throw new Error(`Relation ${relation.id}: roundabout ${way.id} has no exit`);
        for (let step = 1; step <= exit; step++) {
          const node = ring[(start + step) % ring.length];
          sequence.push(node);
          line.push(pointForNode(nodes, node, `Relation ${relation.id} roundabout ${way.id}`));
        }
      } else if (segment[0] === end) {
        sequence.push(...segment.slice(1));
        line.push(...nodePoints(way, nodes, relation.id).slice(1));
      } else if (segment.at(-1) === end) {
        segment.reverse();
        sequence.push(...segment.slice(1));
        line.push(...nodePoints(way, nodes, relation.id).reverse().slice(1));
      } else {
        const previous = pointForNode(
          nodes,
          end,
          `Relation ${relation.id} way ${way.id}`,
        );
        const forward = pointForNode(
          nodes,
          segment[0],
          `Relation ${relation.id} way ${way.id}`,
        );
        const backward = pointForNode(
          nodes,
          segment.at(-1)!,
          `Relation ${relation.id} way ${way.id}`,
        );
        if (metres(previous, forward) <= BUS_JOIN_GAP_M) {
          sequence.push(...segment);
          line.push(...nodePoints(way, nodes, relation.id));
        } else if (metres(previous, backward) <= BUS_JOIN_GAP_M) {
          segment.reverse();
          sequence.push(...segment);
          line.push(...nodePoints(way, nodes, relation.id).reverse());
        } else {
          throw new Error(`Relation ${relation.id}: bus way ${way.id} is disconnected`);
        }
      }
    }
    if (!line.length) throw new Error(`Relation ${relation.id}: geometry is empty`);
    return dedupeLine(line);
  };

  const reorderBySharedNodes = (members: OsmMember[]) => {
    const pool = members.map((member) => ({
      member,
      nodes: [...(ways.get(member.ref)?.nodes ?? [])],
    }));
    if (pool.some((entry) => entry.nodes.length < 2)) return null;
    const order = [pool.shift()!];
    let tailNode = order[0].nodes.at(-1)!;
    while (pool.length) {
      const exact = pool.findIndex(
        (entry) =>
          entry.nodes[0] === tailNode || entry.nodes.at(-1) === tailNode,
      );
      let next = exact;
      if (next < 0) {
        const tail = pointForNode(nodes, tailNode, `Relation ${relation.id}`);
        let bestDistance = Infinity;
        for (let index = 0; index < pool.length; index++) {
          const entry = pool[index];
          const first = pointForNode(nodes, entry.nodes[0], `Relation ${relation.id}`);
          const last = pointForNode(nodes, entry.nodes.at(-1)!, `Relation ${relation.id}`);
          const distance = Math.min(metres(tail, first), metres(tail, last));
          if (distance < bestDistance) {
            bestDistance = distance;
            next = index;
          }
        }
        if (bestDistance > BUS_FALLBACK_GAP_M) return null;
      }
      const [candidate] = pool.splice(next, 1);
      const firstGap = metres(
        pointForNode(nodes, tailNode, `Relation ${relation.id}`),
        pointForNode(nodes, candidate.nodes[0], `Relation ${relation.id}`),
      );
      const lastGap = metres(
        pointForNode(nodes, tailNode, `Relation ${relation.id}`),
        pointForNode(nodes, candidate.nodes.at(-1)!, `Relation ${relation.id}`),
      );
      if (candidate.nodes[0] !== tailNode && lastGap < firstGap) candidate.nodes.reverse();
      tailNode = candidate.nodes.at(-1)!;
      order.push(candidate);
    }
    return order.map((entry) => entry.member);
  };

  let line: LngLat[];
  try {
    line = walk(declared);
  } catch (firstError) {
    const reordered = reorderBySharedNodes(declared);
    if (!reordered) throw firstError;
    line = walk(reordered);
  }
  assertGeometry(relation.id, line);
  return line;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value: string) {
  return normalizeName(value).replace(/\s+/g, "-").toUpperCase();
}

function railStopId(line: LineConfig, call: Call, sequence: number, nodes: Map<number, OsmNode>) {
  const ref = nodes.get(call.nodeId)?.tags?.ref ?? "";
  const token = ref
    .split(/[;,/]/)
    .map((part) => part.trim().replace(/\s+/g, ""))
    .find((part) => part.toUpperCase().startsWith(line.id));
  return token || `${line.id}-${slug(call.name) || String(sequence).padStart(2, "0")}`;
}

function busStopKey(name: string) {
  return normalizeName(name).replace(/\s+[12]$/, "");
}

interface BakedDirection {
  relation: OsmRelation;
  calls: Call[];
  line: LngLat[];
  openingHours: string | null;
}

function validateRelationTags(config: LineConfig, relation: OsmRelation) {
  if (relation.tags?.route !== config.kind) {
    throw new Error(
      `Relation ${relation.id}: route=${relation.tags?.route ?? "missing"}, expected ${config.kind}`,
    );
  }
  if (relation.tags?.ref !== config.id) {
    throw new Error(
      `Relation ${relation.id}: ref=${relation.tags?.ref ?? "missing"}, expected ${config.id}`,
    );
  }
  if (relation.tags?.operator !== config.operator) {
    throw new Error(
      `Relation ${relation.id}: operator=${relation.tags?.operator ?? "missing"}, expected ${config.operator}`,
    );
  }
  // Trans Jatim deliberately has no network tag. Match it by operator only;
  // the KAI and Suroboyo relations must retain their approved network tags.
  if (config.network !== "Trans Jatim" && relation.tags?.network !== config.network) {
    throw new Error(
      `Relation ${relation.id}: network=${relation.tags?.network ?? "missing"}, expected ${config.network}`,
    );
  }
}

function bakeDirection(
  config: LineConfig,
  relation: OsmRelation,
  nodes: Map<number, OsmNode>,
  ways: Map<number, OsmWay>,
): BakedDirection {
  validateRelationTags(config, relation);
  const roles = config.kind === "train" ? STOP_ROLES : config.stopRoles ?? PLATFORM_ROLES;
  const calls = extractCalls(relation, nodes, roles);
  if (!calls.length) throw new Error(`Relation ${relation.id}: no approved stop/platform members`);

  let line = config.kind === "train"
    ? chainRail(relation, ways, nodes, calls)
    : chainBus(relation, ways, nodes);
  line = orientToCalls(line, calls);
  validateCalls(relation.id, line, calls, config.kind === "train" ? 250 : 180);

  return {
    relation,
    calls,
    line,
    openingHours: relation.tags?.opening_hours ?? null,
  };
}

// ---------------------------------------------------------------------------
// Output assembly

interface RouteStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  sequence: number;
}

interface RouteVariant {
  trip_id: string;
  shape_id: string;
  direction_id: string;
  kind: "utama";
  headsign: string;
  via: string | null;
  service_id: "OSM";
  headwaySecs: null;
  windows: [];
  stopCount: number;
  extraStops: [];
  skippedStops: [];
  stopIds: string[];
}

interface RouteDetail {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  route_color: string;
  stops: RouteStop[];
  variants: RouteVariant[];
  geometryByShape: Record<string, LngLat[]>;
  openingHours?: string | null;
  stopsPartial?: boolean;
  provincial?: boolean;
}

interface RouteSummary {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  route_color: string;
  route_text_color: "FFFFFF";
  openingHours?: string | null;
  stopsPartial?: boolean;
  provincial?: boolean;
}

interface StationAnchor {
  routeId: string;
  stopId: string;
  lat: number;
  lon: number;
  color: string;
}

interface StationIndexEntry {
  id: string;
  name: string;
  lat: number;
  lon: number;
  platforms: number;
  routes: string[];
  positions: Record<string, [number, number]>;
  anchors?: StationAnchor[];
}

interface StationAccumulator extends StationIndexEntry {
  anchorKeys: Set<string>;
}

interface BakedMode {
  routes: RouteSummary[];
  details: RouteDetail[];
  stations: StationIndexEntry[];
  overview: { type: "FeatureCollection"; features: unknown[] };
  stopLayer: { type: "FeatureCollection"; features: unknown[] };
  timestamps: Record<string, string | null>;
  relations: number[];
}

function routeDescription(config: LineConfig) {
  return `${config.kind === "train" ? "Commuter Line" : config.network} · ${config.operator}`;
}

function routeStopRecords(config: LineConfig, directions: BakedDirection[], nodesByDirection: Map<number, Map<number, OsmNode>>) {
  const records: Array<{
    key: string;
    name: string;
    point: LngLat;
    stopId: string;
  }> = [];
  const recordForCall = (call: Call, directionIndex: number, callIndex: number) => {
    const key = config.kind === "train"
      ? railStopId(config, call, callIndex + 1, nodesByDirection.get(directionIndex)!)
      : busStopKey(call.name);
    const existing = records.find(
      (record) =>
        record.key === key &&
        (config.kind === "train" || metres(record.point, call.point) <= 85),
    );
    if (existing) return existing;
    const stopId = config.kind === "train"
      ? key
      : `${config.id}-${String(records.length + 1).padStart(3, "0")}`;
    const record = { key, name: call.name, point: call.point, stopId };
    records.push(record);
    return record;
  };

  const directionRecords = directions.map((direction, directionIndex) =>
    direction.calls.map((call, callIndex) =>
      recordForCall(call, directionIndex, callIndex),
    ),
  );
  return { records, directionRecords };
}

function stationMatch(
  stations: StationAccumulator[],
  config: LineConfig,
  stop: RouteStop,
) {
  const key = config.kind === "train" ? normalizeName(stop.stop_name) : busStopKey(stop.stop_name);
  const distanceLimit = config.kind === "train" ? 220 : 100;
  return stations.find(
    (station) =>
      (config.kind === "train"
        ? normalizeName(station.name) === key
        : busStopKey(station.name) === key) &&
      metres([station.lon, station.lat], [stop.stop_lon, stop.stop_lat]) <= distanceLimit,
  );
}

function addStations(
  stations: StationAccumulator[],
  config: LineConfig,
  detail: RouteDetail,
) {
  for (const stop of detail.stops) {
    let station = stationMatch(stations, config, stop);
    if (!station) {
      station = {
        id: `${slug(stop.stop_name)}@${stop.stop_lat.toFixed(5)},${stop.stop_lon.toFixed(5)}`,
        name: stop.stop_name,
        lat: stop.stop_lat,
        lon: stop.stop_lon,
        platforms: 1,
        routes: [],
        positions: {},
        anchorKeys: new Set(),
      };
      stations.push(station);
    }
    if (!station.routes.includes(config.id)) station.routes.push(config.id);
    station.positions[config.id] ??= [stop.sequence, detail.stops.length];
    const anchorKey = `${config.id}:${stop.stop_id}`;
    if (!station.anchorKeys.has(anchorKey)) {
      station.anchorKeys.add(anchorKey);
      if (config.kind === "train") {
        station.anchors ??= [];
        station.anchors.push({
          routeId: config.id,
          stopId: stop.stop_id,
          lat: round(stop.stop_lat),
          lon: round(stop.stop_lon),
          color: `#${config.color}`,
        });
      }
    }
  }
}

function finalizeStations(stations: StationAccumulator[]): StationIndexEntry[] {
  return stations.map(({ anchorKeys: _anchorKeys, ...station }) => ({
    ...station,
    routes: [...station.routes].sort(),
    ...(station.anchors && station.anchors.length > 1
      ? { anchors: station.anchors }
      : {}),
  }));
}

function buildMode(
  mode: Mode,
  configs: readonly LineConfig[],
  documents: Map<number, OsmDocument>,
): BakedMode {
  const routes: RouteSummary[] = [];
  const details: RouteDetail[] = [];
  const stations: StationAccumulator[] = [];
  const overviewFeatures: unknown[] = [];
  const timestamps: Record<string, string | null> = {};
  const relations = configs.flatMap((config) => config.relations);

  for (const config of configs) {
    const directions: BakedDirection[] = [];
    const nodeMaps = new Map<number, Map<number, OsmNode>>();
    for (const relationId of config.relations) {
      const document = documents.get(relationId);
      if (!document) throw new Error(`Relation ${relationId}: document was not fetched`);
      const relation = relationOf(document, relationId);
      const nodes = nodesOf(document);
      nodeMaps.set(directions.length, nodes);
      timestamps[String(relationId)] = latestOsmTimestamp(document);
      directions.push(bakeDirection(config, relation, nodes, waysOf(document)));
    }

    const { records, directionRecords } = routeStopRecords(config, directions, nodeMaps);
    const stops: RouteStop[] = records.map((record, index) => ({
      stop_id: record.stopId,
      stop_name: record.name,
      stop_lat: round(record.point[1]),
      stop_lon: round(record.point[0]),
      sequence: index + 1,
    }));
    const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));
    const variants: RouteVariant[] = directions.map((direction, index) => {
      const stopIds = directionRecords[index].map((record) => record.stopId);
      const finalCall = direction.calls.at(-1)!;
      return {
        trip_id: `${config.id}-${index}`,
        shape_id: `${config.id}-${index}`,
        direction_id: String(index),
        kind: "utama",
        headsign: direction.relation.tags?.to ?? finalCall.name,
        via: direction.relation.tags?.via ?? null,
        service_id: "OSM",
        headwaySecs: null,
        windows: [],
        stopCount: stopIds.length,
        extraStops: [],
        skippedStops: [],
        stopIds,
      };
    });
    const geometryByShape = Object.fromEntries(
      directions.map((direction, index) => [
        `${config.id}-${index}`,
        direction.line.map(([lon, lat]) => [round(lon), round(lat)] as LngLat),
      ]),
    );
    const openingHours = directions.find((direction) => direction.openingHours)?.openingHours ?? null;
    const summary: RouteSummary = {
      route_id: config.id,
      route_short_name: config.id,
      route_long_name: config.name,
      route_desc: routeDescription(config),
      route_color: config.color,
      route_text_color: "FFFFFF",
      ...(openingHours ? { openingHours } : {}),
      ...(config.stopsPartial !== undefined ? { stopsPartial: config.stopsPartial } : {}),
      ...(config.provincial ? { provincial: true } : {}),
    };
    const detail: RouteDetail = {
      ...summary,
      stops,
      variants,
      geometryByShape,
    };
    routes.push(summary);
    details.push(detail);
    addStations(stations, config, detail);
    for (const [index, direction] of directions.entries()) {
      overviewFeatures.push({
        type: "Feature",
        properties: {
          color: `#${config.color}`,
          opacity: 1,
          width: config.kind === "train" ? 3 : 3,
          routeId: config.id,
          shapeId: `${config.id}-${index}`,
        },
        geometry: {
          type: "LineString",
          coordinates: direction.line.map(([lon, lat]) => [round(lon), round(lat)]),
        },
      });
    }

    const missingStopIds = variants.flatMap((variant) =>
      variant.stopIds.filter((stopId) => !stopById.has(stopId)),
    );
    if (missingStopIds.length) {
      throw new Error(`${config.id}: variant contains stops absent from its route detail`);
    }
    console.log(
      `  ${mode}/${config.id}: ${stops.length} unique stops, ${variants.length} variant(s), ` +
        `${directions.map((direction) => direction.calls.length).join("/")} ordered calls`,
    );
  }

  const finalizedStations = finalizeStations(stations);
  return {
    routes,
    details,
    stations: finalizedStations,
    overview: { type: "FeatureCollection", features: overviewFeatures },
    stopLayer: {
      type: "FeatureCollection",
      features: finalizedStations.map((station) => ({
        type: "Feature",
        properties: {
          name: station.name,
          routes: station.routes.length,
          stationId: station.id,
          ...(station.anchors ? { anchors: station.anchors } : {}),
        },
        geometry: { type: "Point", coordinates: [station.lon, station.lat] },
      })),
    },
    timestamps,
    relations,
  };
}

function metaFor(mode: Mode, configs: readonly LineConfig[], baked: BakedMode) {
  const timestamps = Object.values(baked.timestamps).filter(
    (timestamp): timestamp is string => Boolean(timestamp),
  );
  return {
    source: "OpenStreetMap relation full API",
    attribution: "© OpenStreetMap contributors",
    userAgent: USER_AGENT,
    osmTimestamp: timestamps.sort().at(-1) ?? null,
    osmTimestamps: baked.timestamps,
    syncedAt: new Date().toISOString(),
    mode,
    relations: baked.relations,
    routes: configs.map((config) => config.id),
    routeCount: baked.routes.length,
    variantCount: baked.routes.reduce((count, route) => {
      const detail = baked.details.find((candidate) => candidate.route_id === route.route_id);
      return count + (detail?.variants.length ?? 0);
    }, 0),
    stationCount: baked.stations.length,
    displayPalette: true,
    paletteNote: "Colours are a display palette, not official operator colours.",
    scope: configs.map((config) => config.scope),
    ...(mode === "sby-kai"
      ? {
          excludedRelations: EXCLUDED_TUMAPEL.map((relation) => ({
            relation,
            ref: "T",
            reason: "Tumapel ceased operating 2025-01-31",
          })),
          unverifiedRelations: configs
            .filter((config) => config.unverified)
            .flatMap((config) =>
              config.relations.map((relation) => ({
                relation,
                ref: config.id,
                reason: "Sindro is absent from KAI Commuter's published six-service list",
              })),
            ),
        }
      : {}),
    ...(mode === "sby-transjatim"
      ? {
          provincial: true,
          note: "These are provincial corridors and are mostly outside Surabaya city.",
        }
      : {}),
  };
}

async function writeDataset(
  mode: Mode,
  baked: BakedMode,
  configs: readonly LineConfig[],
) {
  const output = path.join(DATA_ROOT, mode);
  const temporary = `${output}.tmp-${process.pid}`;
  const backup = `${output}.bak-${process.pid}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.mkdir(path.join(temporary, "routes"), { recursive: true });
  const files: Record<string, unknown> = {
    "routes.json": baked.routes,
    "stops.json": baked.stations,
    "stops-geo.json": baked.stopLayer,
    "overview.json": baked.overview,
    ".meta.json": metaFor(mode, configs, baked),
  };
  for (const detail of baked.details) {
    files[`routes/${encodeURIComponent(detail.route_id)}.json`] = detail;
  }

  try {
    for (const [name, value] of Object.entries(files)) {
      const target = path.join(temporary, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(
        target,
        JSON.stringify(value, null, name === ".meta.json" ? 2 : undefined),
      );
    }
    const exists = await fs
      .access(output)
      .then(() => true)
      .catch(() => false);
    if (exists) await fs.rename(output, backup);
    try {
      await fs.rename(temporary, output);
    } catch (error) {
      if (exists) await fs.rename(backup, output);
      throw error;
    }
    if (exists) await fs.rm(backup, { recursive: true, force: true });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function byteCount(files: string[]) {
  const stats = await Promise.all(files.map((file) => fs.stat(file)));
  return stats.reduce(
    (total, stat) => total + (stat.isFile() ? stat.size : 0),
    0,
  );
}

async function datasetBytes(mode: Mode) {
  const output = path.join(DATA_ROOT, mode);
  const entries = await fs.readdir(output, { recursive: true });
  const files = entries
    .filter((entry): entry is string => !entry.endsWith("/"))
    .map((entry) => path.join(output, entry));
  return byteCount(files);
}

async function main() {
  const allConfigs = Object.values(SYSTEMS).flat();
  const relationIds = [...new Set(allConfigs.flatMap((config) => config.relations))];
  console.log(`-> Loading ${relationIds.length} approved Surabaya relations from OSM full API`);
  const documents = new Map<number, OsmDocument>();
  for (const relationId of relationIds) {
    documents.set(relationId, await fetchRelation(relationId));
  }

  const bakedByMode = new Map<Mode, BakedMode>();
  for (const mode of Object.keys(SYSTEMS) as Mode[]) {
    console.log(`-> Validating and baking ${mode}`);
    const baked = buildMode(mode, SYSTEMS[mode], documents);
    bakedByMode.set(mode, baked);
  }

  let totalBytes = 0;
  for (const mode of Object.keys(SYSTEMS) as Mode[]) {
    const baked = bakedByMode.get(mode)!;
    await writeDataset(mode, baked, SYSTEMS[mode]);
    const bytes = await datasetBytes(mode);
    totalBytes += bytes;
    console.log(
      `✓ ${mode}: ${baked.routes.length} routes, ${baked.stations.length} stations, ` +
        `${baked.details.reduce((total, detail) => total + detail.variants.length, 0)} variants, ${bytes} bytes`,
    );
  }
  console.log(`✓ Total bytes written: ${totalBytes}`);
}

main().catch((error) => {
  console.error("✗ Surabaya sync failed:", error);
  process.exitCode = 1;
});
