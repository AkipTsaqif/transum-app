/**
 * Bake the KRL data set into data/krl/.
 *
 * Route relations come from the OSM API's /full.json endpoint instead of
 * Overpass.  Overpass is used only for railway=station marker nodes.  The
 * route data has no timetable: this script deliberately writes no invented
 * service frequency.
 *
 * Run with: npm run sync:krl
 */

import fs from "node:fs/promises";
import path from "node:path";
import { airportLineOffset } from "../utils/krl-line-offset";
import { airportDisplayLine, airportManggaraiDisplayPoint } from "../utils/krl-display";

// ---------------------------------------------------------------------------
// Configuration

interface LineConfig {
    id: string;
    short: string;
    color: string;
    relations: number[];
    longName: string;
    /** Full-racket relations must retain member order and repeated stops. */
    orderedWays?: boolean;
    oneWay?: Record<string, number>;
    canonicalByName?: Record<string, string>;
    /** One pair of main directions, then optional branch variants. */
    mainDirections?: number;
    /** Passenger stops verified against the published KAI Commuter timetable. */
    servedStations?: string[];
    /**
     * Stations that operate on the line but are missing from the relation's
     * stop members. They are added by name from nodes the relation already
     * contains, then placed by their position on the track, so the line can be
     * complete without inventing a coordinate.
     */
    extraStations?: string[];
}

const C_STATIONS: Record<string, string> = {
    "pondok jati": "C01",
    kramat: "C02",
    "gang sentiong": "C03",
    "pasar senen": "C04",
    kemayoran: "C05",
    rajawali: "C06",
    "kampung bandan": "C07",
    angke: "C08",
    duri: "C09",
    "tanah abang": "C10",
    "bni city": "C11",
    sudirman: "C12",
    manggarai: "C13",
    matraman: "C14",
    jatinegara: "C15",
    klender: "C16",
    buaran: "C17",
    "klender baru": "C18",
    cakung: "C19",
    kranji: "C20",
    bekasi: "C21",
    "bekasi timur": "C22",
    tambun: "C23",
    cibitung: "C24",
    "metland telagamurni": "C25",
    cikarang: "C26",
};

const LINES: LineConfig[] = [
    {
        id: "TP",
        short: "TP",
        color: "EF509A",
        relations: [17193008, 2922237],
        longName: "Jakarta Kota - Tanjung Priuk",
        oneWay: { TP04: 1 },
    },
    {
        id: "C",
        short: "C",
        color: "26BAED",
        // First slice: the two full rackets.  The twelve half-racket
        // relations are intentionally not emitted until their service
        // classification is independently verified.
        relations: [2922163, 15094545],
        longName: "Cikarang - Kampung Bandan",
        orderedWays: true,
        canonicalByName: C_STATIONS,
    },
    {
        id: "T",
        short: "T",
        // Tangerang line colour in the KAI Commuter Wikipedia line module.
        color: "C25F28",
        relations: [17193463, 2922235],
        longName: "Duri - Tangerang",
        canonicalByName: { "rawa buaya": "T06" },
    },
    {
        id: "A",
        short: "A",
        // OSM airport line publishes #2e2f70; both directions share one service.
        color: "2E2F70",
        relations: [17675695, 17675694],
        longName: "Manggarai - Bandara Soekarno-Hatta",
        // KAI Commuter's timetable has six passenger stops. OSM also lists
        // Sudirman as a stop member, though this service does not call there.
        servedStations: ["Manggarai", "BNI City", "Duri", "Rawa Buaya", "Batu Ceper", "Bandara Soekarno 2"],
        canonicalByName: {
            manggarai: "A01", "bni city": "A02", duri: "A03",
            "rawa buaya": "A04", "batu ceper": "A05", "bandara soekarno 2": "A06",
        },
    },
    {
        id: "R",
        short: "R",
        // Rangkasbitung line colour: KAI Commuter's green (#99ca3e).
        color: "99CA3E",
        // 15094546 is Tanah Abang -> Rangkasbitung, 2922215 the return.
        relations: [15094546, 2922215],
        longName: "Tanah Abang - Rangkasbitung",
        // OSM refs are partial (THB, R04..R09, R11); the rest follow the
        // operator's published R01-R22 numbering.
        canonicalByName: {
            "tanah abang": "R01", palmerah: "R02", kebayoran: "R03",
            "pondok ranji": "R04", jurangmangu: "R05", sudimara: "R06",
            "rawa buntu": "R07", serpong: "R08", cisauk: "R09",
            cicayur: "R10", jatake: "R11", "parung panjang": "R12",
            parungpanjang: "R12", cilejit: "R14", daru: "R15", tenjo: "R16",
            tigaraksa: "R18", cikoya: "R19", maja: "R20", citeras: "R21",
            rangkasbitung: "R22",
        },
        // Cikoya operates (R19) but is not a stop member of either relation.
        extraStations: ["Cikoya"],
    },
    {
        id: "B",
        short: "B",
        // OSM route master 16877214 publishes #ec2329 for the Bogor line.
        color: "EC2329",
        relations: [16877210, 16877212, 16877211, 16877213],
        longName: "Jakarta Kota - Bogor / Nambo",
        mainDirections: 2,
        canonicalByName: { "pasar minggu baru": "B13" },
    },
];

const OUT_DIR = path.join(process.cwd(), "data", "krl");
const ROUTES_DIR = path.join(OUT_DIR, "routes");
const OSM_API = "https://api.openstreetmap.org/api/0.6";
const MIRRORS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT =
    "transum-app/0.1 (+https://github.com/AkipTsaqif/transum-app) krl-sync";
const STATION_BBOX = "-6.62,106.12,-6.10,107.17";
const MAX_JOIN_GAP_M = 20;
const STATION_MATCH_M = 1000;
const CLUSTER_M = 150;
// The airport terminal platform at Manggarai is ~174m from the KRL platforms.
const MANGGARAI_CLUSTER_M = 200;
const STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);

// ---------------------------------------------------------------------------
// OSM types and HTTP

type LngLat = [number, number];

interface OsmNode {
    type: "node";
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
}

interface OsmWay {
    type: "way";
    id: number;
    nodes: number[];
    geometry?: { lat: number; lon: number }[];
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
    tags?: Record<string, string>;
}

interface OsmFull {
    osm3s?: { timestamp_osm_base?: string };
    elements: Array<OsmNode | OsmWay | OsmRelation>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, attempts = 4): Promise<any> {
    let last = "";
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
                signal: AbortSignal.timeout(90_000),
            });
            const text = await response.text();
            if (response.ok && text.trimStart().startsWith("{")) {
                return JSON.parse(text);
            }
            last = `${response.status}: ${text.slice(0, 160)}`;
        } catch (error) {
            last = (error as Error).message;
        }
        await sleep(1000 * 2 ** attempt);
    }
    throw new Error(`${url} failed after ${attempts} attempts (${last})`);
}

async function fetchRelation(id: number): Promise<OsmFull> {
    return (await getJson(`${OSM_API}/relation/${id}/full.json`)) as OsmFull;
}

async function fetchStationNodes(): Promise<{
    nodes: OsmNode[];
    timestamp: string;
}> {
    const query = `[out:json][timeout:90];node["railway"~"^(station|halt)$"](${STATION_BBOX});out body;`;
    let last = "";
    for (let round = 0; round < 3; round++) {
        for (const mirror of MIRRORS) {
            try {
                const response = await fetch(mirror, {
                    method: "POST",
                    headers: {
                        "User-Agent": USER_AGENT,
                        "Content-Type": "application/x-www-form-urlencoded",
                        Accept: "application/json",
                    },
                    body: `data=${encodeURIComponent(query)}`,
                    signal: AbortSignal.timeout(90_000),
                });
                const text = await response.text();
                if (response.ok && text.trimStart().startsWith("{")) {
                    const parsed = JSON.parse(text) as {
                        osm3s?: { timestamp_osm_base?: string };
                        elements: OsmNode[];
                    };
                    const named = new Set(parsed.elements.map((n) => n.tags?.name));
                    // Mirrors sometimes return a valid JSON body from an empty
                    // or badly stale snapshot. Both endpoints must exist.
                    if (named.has("Jakarta Kota") && named.has("Cikarang") && named.has("Tangerang") && named.has("Bogor") && named.has("Nambo") && named.has("Rangkasbitung")) {
                        return {
                            nodes: parsed.elements,
                            timestamp: parsed.osm3s?.timestamp_osm_base ?? "",
                        };
                    }
                    last = `${mirror} returned no named stations`;
                } else {
                    last = `${mirror} -> HTTP ${response.status}`;
                }
            } catch (error) {
                last = `${mirror} -> ${(error as Error).message}`;
            }
            await sleep(1000);
        }
    }
    throw new Error(`Every station Overpass mirror failed (${last})`);
}

// ---------------------------------------------------------------------------
// Geometry

const M_PER_DEG_LAT = 110540;
const kx = (lat: number) => Math.cos((lat * Math.PI) / 180) * 111320;
const metres = (a: LngLat, b: LngLat) =>
    Math.hypot((a[0] - b[0]) * kx((a[1] + b[1]) / 2), (a[1] - b[1]) * M_PER_DEG_LAT);
const round = (n: number) => Number.parseFloat(n.toFixed(6));
const nameKey = (name: string) =>
    name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

function wayPoints(way: OsmWay, nodes: Map<number, OsmNode>): LngLat[] {
    if (way.geometry?.length) {
        return way.geometry.map((point) => [point.lon, point.lat]);
    }
    return way.nodes
        .map((id) => nodes.get(id))
        .filter((node): node is OsmNode => Boolean(node))
        .map((node) => [node.lon, node.lat]);
}

/**
 * OSM relation members are route ordered, but individual ways can be stored
 * in either direction.  Keep member order and orient each way to the previous
 * endpoint.  A small tolerance covers the two known five-metre digitising
 * gaps, while a large jump is a hard error rather than a broken map line.
 */
function chainWays(
    relation: OsmRelation,
    ways: Map<number, OsmWay>,
    nodes: Map<number, OsmNode>,
    preserveMemberOrder: boolean
): LngLat[] {
    const members = relation.members.filter((member) => member.type === "way");
    if (!members.length) throw new Error(`Relation ${relation.id}: no track ways`);

    const geometries = members.map((member) => {
        const way = ways.get(member.ref);
        if (!way) throw new Error(`Relation ${relation.id}: missing way ${member.ref}`);
        const points = wayPoints(way, nodes);
        if (points.length < 2) {
            throw new Error(`Relation ${relation.id}: way ${member.ref} has no geometry`);
        }
        return points;
    });

    if (!preserveMemberOrder) {
        // Some relations' members are not in travel order. Reconnect ways at
        // either end, as the previous TP-only sync did, before orienting the
        // complete chain against its first and last relation stops.
        const pool = [...geometries];
        let chain = [...pool.shift()!];
        while (pool.length) {
            const head = chain[0];
            const tail = chain.at(-1)!;
            const index = pool.findIndex((points) =>
                [points[0], points.at(-1)!].some(
                    (end) => metres(end, head) < 2 || metres(end, tail) < 2
                )
            );
            if (index < 0) {
                throw new Error(`Relation ${relation.id}: disconnected track way`);
            }
            const points = pool.splice(index, 1)[0];
            if (metres(points[0], tail) < 2) chain = chain.concat(points.slice(1));
            else if (metres(points.at(-1)!, tail) < 2)
                chain = chain.concat([...points].reverse().slice(1));
            else if (metres(points.at(-1)!, head) < 2)
                chain = points.concat(chain.slice(1));
            else chain = [...points].reverse().concat(chain.slice(1));
        }
        const stopMembers = relation.members.filter(
            (member) => member.type === "node" && STOP_ROLES.has(member.role)
        );
        const firstStop = stopMembers[0] && nodes.get(stopMembers[0].ref);
        const last = stopMembers.at(-1);
        const lastStop = last && nodes.get(last.ref);
        if (!firstStop || !lastStop) throw new Error(`Relation ${relation.id}: missing terminal stops`);
        const forward =
            metres(chain[0], [firstStop.lon, firstStop.lat]) +
            metres(chain.at(-1)!, [lastStop.lon, lastStop.lat]);
        const backward =
            metres(chain.at(-1)!, [firstStop.lon, firstStop.lat]) +
            metres(chain[0], [lastStop.lon, lastStop.lat]);
        return backward < forward ? chain.reverse() : chain;
    }

    const first = geometries[0];
    const firstStops = relation.members
        .filter((member) => member.type === "node" && STOP_ROLES.has(member.role))
        .map((member) => nodes.get(member.ref))
        .filter((node): node is OsmNode => Boolean(node));
    if (!firstStops.length) throw new Error(`Relation ${relation.id}: no stop members`);

    // Orient the first member toward the first relation stop.  For a loop the
    // first stop is still a reliable endpoint because the full-relation data
    // starts at the Cikarang endpoint.
    const firstStop: LngLat = [firstStops[0].lon, firstStops[0].lat];
    let chain =
        metres(first[0], firstStop) <= metres(first.at(-1)!, firstStop)
            ? [...first]
            : [...first].reverse();

    for (const points of geometries.slice(1)) {
        const tail = chain.at(-1)!;
        const forwardGap = metres(tail, points[0]);
        const reverseGap = metres(tail, points.at(-1)!);
        const gap = Math.min(forwardGap, reverseGap);
        if (gap > MAX_JOIN_GAP_M) {
            throw new Error(
                `Relation ${relation.id}: way chain jump ${gap.toFixed(1)}m exceeds ${MAX_JOIN_GAP_M}m`
            );
        }
        const oriented = forwardGap <= reverseGap ? points : [...points].reverse();
        chain = chain.concat(oriented.slice(1));
    }

    return chain.filter(
        (point, index) => index === 0 || metres(point, chain[index - 1]) > 0.01
    );
}

function lengthM(line: LngLat[]) {
    return line.slice(1).reduce((total, point, index) => total + metres(line[index], point), 0);
}

function project(line: LngLat[], point: LngLat) {
    let best: { along: number; off: number; pt: LngLat } = {
        along: 0,
        off: Infinity,
        pt: line[0],
    };
    let walked = 0;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const scale = kx(a[1]);
        const abx = (b[0] - a[0]) * scale;
        const aby = (b[1] - a[1]) * M_PER_DEG_LAT;
        const apx = (point[0] - a[0]) * scale;
        const apy = (point[1] - a[1]) * M_PER_DEG_LAT;
        const len2 = abx * abx + aby * aby;
        const t = len2
            ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2))
            : 0;
        const off = Math.hypot(apx - abx * t, apy - aby * t);
        if (off < best.off) {
            best = {
                along: walked + Math.sqrt(len2) * t,
                off,
                pt: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            };
        }
        walked += Math.sqrt(len2);
    }
    return best;
}

// ---------------------------------------------------------------------------
// Route extraction

interface StationCall {
    id: string;
    name: string;
    lat: number;
    lon: number;
}

interface Direction {
    relation: OsmRelation;
    line: LngLat[];
    calls: StationCall[];
}

interface RouteStation extends StationCall {
    sequence: number;
}

function stationId(cfg: LineConfig, node: OsmNode): string {
    const name = node.tags?.name ?? "";
    const canonical = cfg.canonicalByName?.[nameKey(name)];
    if (canonical) return canonical;
    const ref = node.tags?.ref?.trim();
    if (!ref) throw new Error(`${cfg.id}: station ${name || node.id} has no ref`);
    return ref.replace(/\s+/g, "");
}

function nearestLineIndex(line: LngLat[], point: LngLat): number {
    let best = 0;
    let distance = Infinity;
    for (let index = 0; index < line.length; index++) {
        const d = metres(line[index], point);
        if (d < distance) {
            distance = d;
            best = index;
        }
    }
    return best;
}

/** Remove overhanging buffer-stop track past the first/last terminal call.
 * OSM routes include real track beyond the platform, which made the brown
 * Tangerang line continue past both end markers. Keep the station itself and
 * cut only the geometry beyond it. */
function trimLineToStops(line: LngLat[], calls: StationCall[]): LngLat[] {
    // Trim only what is beyond the first and final relation stop. The
    // endpoint itself is the relation stop coordinate, so the line ends at
    // the station marker rather than at a nearby buffer-stop track vertex.
    const first = calls[0];
    const last = calls.at(-1)!;

    if (first.id === last.id) {
        // A racket starts and ends at the same station (Cikarang). Searching
        // the whole line for its nearest vertex would collapse the loop, so
        // search only the two ends. The slice between them keeps the loop and
        // cuts the buffer-stop spurs past the shared terminal.
        const window = Math.max(8, Math.floor(line.length * 0.1));
        const along = (index: number) => metres(line[index], [first.lon, first.lat]);
        let start = 0;
        for (let i = 1; i <= window && i < line.length; i++) {
            if (along(i) < along(start)) start = i;
        }
        let end = line.length - 1;
        for (let i = line.length - 2; i >= line.length - window - 1 && i >= 0; i--) {
            if (along(i) < along(end)) end = i;
        }
        if (start >= end) return line;
        const loop = line.slice(start, end + 1);
        loop[0] = [first.lon, first.lat];
        loop[loop.length - 1] = [first.lon, first.lat];
        return loop;
    }

    const startIndex = nearestLineIndex(line, [first.lon, first.lat]);
    const endIndex = nearestLineIndex(line, [last.lon, last.lat]);
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    const sliced = line.slice(from, to + 1);
    const firstCall = startIndex <= endIndex ? first : last;
    const lastCall = startIndex <= endIndex ? last : first;
    sliced[0] = [firstCall.lon, firstCall.lat];
    sliced[sliced.length - 1] = [lastCall.lon, lastCall.lat];
    return sliced;
}

function gather(
    cfg: LineConfig,
    relation: OsmRelation,
    nodes: Map<number, OsmNode>,
    ways: Map<number, OsmWay>
): Direction {
    const line = chainWays(relation, ways, nodes, cfg.orderedWays ?? false);
    const stopMembers = relation.members.filter(
        (member) => member.type === "node" && STOP_ROLES.has(member.role)
    );
    const calls = stopMembers.map((member) => {
        const node = nodes.get(member.ref);
        if (!node) throw new Error(`Relation ${relation.id}: missing stop node ${member.ref}`);
        return {
            id: stationId(cfg, node),
            name: node.tags?.name ?? node.tags?.ref ?? String(node.id),
            lat: node.lat,
            lon: node.lon,
        };
    });
    for (const name of cfg.extraStations ?? []) {
        const key = nameKey(name);
        if (calls.some((call) => nameKey(call.name) === key)) continue;
        const node = [...nodes.values()].find(
            (n) => nameKey(n.tags?.name ?? "") === key &&
                /^(stop|station)$/.test(n.tags?.railway ?? "") &&
                project(line, [n.lon, n.lat]).off < 120
        );
        if (!node) {
            throw new Error(`Relation ${relation.id}: extra station ${name} not found on the track`);
        }
        calls.push({
            id: stationId(cfg, node),
            name: node.tags?.name ?? name,
            lat: node.lat,
            lon: node.lon,
        });
    }
    if (cfg.extraStations?.length) {
        // Added out of order; restore travel order by where they sit on the line.
        calls.sort(
            (a, b) =>
                project(line, [a.lon, a.lat]).along - project(line, [b.lon, b.lat]).along
        );
    }

    const served = cfg.servedStations && new Set(cfg.servedStations.map(nameKey));
    const passengerCalls = served
        ? calls.filter((call) => served.has(nameKey(call.name)))
        : calls;
    if (passengerCalls.length < 2) throw new Error(`Relation ${relation.id}: fewer than two stops`);
    if (served && (passengerCalls.length !== served.size ||
        new Set(passengerCalls.map((call) => nameKey(call.name))).size !== served.size)) {
        throw new Error(`Relation ${relation.id}: missing or duplicated airport passenger stops`);
    }

    const endpointA = project(line, [passengerCalls[0].lon, passengerCalls[0].lat]).off;
    const endpointZ = project(line, [passengerCalls.at(-1)!.lon, passengerCalls.at(-1)!.lat]).off;
    if (endpointA > 250 || endpointZ > 250) {
        throw new Error(
            `Relation ${relation.id}: stop is ${Math.max(endpointA, endpointZ).toFixed(0)}m off chained track`
        );
    }
    return { relation, line, calls: passengerCalls };
}

function locate(
    station: StationCall,
    line: LngLat[],
    stationNodes: OsmNode[]
): { lat: number; lon: number; nodeId: number } {
    const here: LngLat = [station.lon, station.lat];
    // The OSM airport platform is "Bandara Soekarno 2", but the station
    // marker and public name are "Bandara Soekarno-Hatta".
    const key = nameKey(station.name) === "bandara soekarno 2"
        ? "bandara soekarno hatta" : nameKey(station.name);
    const hit = stationNodes
        .filter((node) => nameKey(node.tags?.name ?? "") === key)
        .map((node) => ({ node, distance: metres(here, [node.lon, node.lat]) }))
        .filter((candidate) => candidate.distance <= STATION_MATCH_M)
        .sort((a, b) => a.distance - b.distance)[0];
    if (!hit) {
        throw new Error(`${station.id} ${station.name}: no railway=station node found`);
    }
    const snapped = project(line, [hit.node.lon, hit.node.lat]).pt;
    return { lat: snapped[1], lon: snapped[0], nodeId: hit.node.id };
}

function uniqueStations(directions: Direction[], cfg: LineConfig): RouteStation[] {
    const byId = new Map<string, StationCall & { count: number }>();
    for (const direction of directions) {
        for (const call of direction.calls) {
            const previous = byId.get(call.id);
            if (previous) {
                previous.lat = (previous.lat * previous.count + call.lat) / (previous.count + 1);
                previous.lon = (previous.lon * previous.count + call.lon) / (previous.count + 1);
                previous.count++;
            } else {
                byId.set(call.id, { ...call, count: 1 });
            }
        }
    }
    const list = [...byId.values()].map(({ count: _count, ...station }) => station);
    if (cfg.id === "A") {
        list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    } else if (cfg.id === "C" || cfg.id === "B") {
        // Branch stops are not on the Bogor trunk: keep them after the main
        // numbered stations instead of projecting them to a nearby trunk
        // segment, which interleaves Nambo between Depok and Citayam.
        const order = cfg.id === "B"
            ? (id: string) => id.startsWith("b")
                ? 100 + Number(id.slice(1))
                : Number(id.slice(1))
            : (id: string) => Number(id.slice(1));
        list.sort((a, b) => order(a.id) - order(b.id));
    } else {
        const line = directions[0].line;
        list.sort(
            (a, b) =>
                project(line, [a.lon, a.lat]).along - project(line, [b.lon, b.lat]).along
        );
    }
    return list.map((station, index) => ({ ...station, sequence: index + 1 }));
}

function routeVariant(cfg: LineConfig, direction: Direction, index: number) {
    const via = direction.relation.tags?.via ?? null;
    const finalName = cfg.id === "C" ? "Cikarang" :
        cfg.id === "A" && direction.calls.at(-1)!.id === "A06"
            ? "Bandara Soekarno-Hatta"
            : direction.calls.at(-1)!.name;
    return {
        trip_id: `${cfg.id}-${index}`,
        shape_id: `${cfg.id}-${index}`,
        direction_id: String(index),
        kind: "utama",
        headsign: cfg.id === "C" && via ? `${finalName} via ${via}` : finalName,
        via: cfg.id === "C" ? via : null,
        service_id: "OSM",
        headwaySecs: null,
        windows: [],
        stopCount: direction.calls.length,
        extraStops: [],
        skippedStops: [],
        // Do not deduplicate: both Cikarang endpoints and both Jatinegara
        // calls are meaningful parts of the loop pattern.
        stopIds: direction.calls.map((call) => call.id),
    };
}

// ---------------------------------------------------------------------------
// Output

async function writeJson(file: string, value: unknown, pretty = false) {
    await fs.writeFile(file, JSON.stringify(value, null, pretty ? 2 : undefined));
}

interface AggregateStation {
    name: string;
    lat: number;
    lon: number;
    count: number;
    routes: Set<string>;
    positions: Record<string, [number, number]>;
    anchors: { routeId: string; stopId: string; lat: number; lon: number; color: string }[];
}

function addToStationIndex(
    aggregate: AggregateStation[],
    routeId: string,
    color: string,
    stops: RouteStation[]
) {
    for (const stop of stops) {
        const hit = aggregate.find(
            (candidate) =>
                nameKey(candidate.name) === nameKey(stop.name) &&
                candidate.anchors.some(
                    (anchor) =>
                        metres([anchor.lon, anchor.lat], [stop.lon, stop.lat]) <=
                        (routeId === "A" && nameKey(stop.name) === "manggarai"
                            ? MANGGARAI_CLUSTER_M : CLUSTER_M)
                )
        );
        if (hit) {
            // Keep the first line's snapped marker, rather than averaging
            // coordinates on two different tracks. TP is processed first:
            // its Kampung Bandan marker remains on the TP line, while C's
            // route detail keeps its own pin on the C track.
            hit.count++;
            hit.routes.add(routeId);
            hit.positions[routeId] ??= [stop.sequence, stops.length];
            hit.anchors.push({
                routeId,
                stopId: stop.id,
                lat: stop.lat,
                lon: stop.lon,
                color: `#${color}`,
            });
        } else {
            aggregate.push({
                name: stop.name,
                lat: stop.lat,
                lon: stop.lon,
                count: 1,
                routes: new Set([routeId]),
                positions: { [routeId]: [stop.sequence, stops.length] },
                anchors: [{
                    routeId,
                    stopId: stop.id,
                    lat: stop.lat,
                    lon: stop.lon,
                    color: `#${color}`,
                }],
            });
        }
    }
}

async function main() {
    console.log("-> Fetching OSM route relations from the OSM API");
    const [stationData, ...fullRelations] = await Promise.all([
        fetchStationNodes(),
        ...LINES.flatMap((line) => line.relations.map(fetchRelation)),
    ]);
    const relationById = new Map<number, OsmFull>();
    let relationIndex = 0;
    for (const line of LINES) {
        for (const relationId of line.relations) {
            relationById.set(relationId, fullRelations[relationIndex++]);
        }
    }

    const routeIndex: unknown[] = [];
    const stationAggregate: AggregateStation[] = [];
    const overviewFeatures: unknown[] = [];
    const outputFiles = new Map<string, unknown>();

    for (const cfg of LINES) {
        const directions = cfg.relations.map((relationId) => {
            const data = relationById.get(relationId)!;
            const nodes = new Map(
                data.elements
                    .filter((element): element is OsmNode => element.type === "node")
                    .map((node) => [node.id, node])
            );
            const ways = new Map(
                data.elements
                    .filter((element): element is OsmWay => element.type === "way")
                    .map((way) => [way.id, way])
            );
            const relation = data.elements.find(
                (element): element is OsmRelation =>
                    element.type === "relation" && element.id === relationId
            );
            if (!relation) throw new Error(`Relation ${relationId} was not returned`);
            return gather(cfg, relation, nodes, ways);
        });

        for (const [id, onlyDirection] of Object.entries(cfg.oneWay ?? {})) {
            if (!directions.some((direction) => direction.calls.some((call) => call.id === id))) {
                throw new Error(`${cfg.id}: one-way station ${id} was not found`);
            }
            directions.forEach((direction, index) => {
                if (index !== onlyDirection) {
                    direction.calls = direction.calls.filter((call) => call.id !== id);
                }
            });
        }

        // TP04 belongs only to the westbound relation. Keep its station in
        // the route's unique stop list, but never add it to eastbound calls.
        const routeStops = uniqueStations(directions, cfg);
        const placed = new Map<string, { lat: number; lon: number }>();
        for (const station of routeStops) {
            // A branch-only stop is not on the first (Bogor) trunk shape.
            // Snap it to the direction that actually calls there; otherwise
            // Cibinong/Nambo get projected onto the distant Bogor track.
            const serving = directions.find((direction) =>
                direction.calls.some((call) => call.id === station.id)
            );
            if (!serving) throw new Error(`${cfg.id}: no relation serves ${station.id}`);
            const position = locate(station, serving.line, stationData.nodes);
            placed.set(station.id, { lat: position.lat, lon: position.lon });
            station.lat = position.lat;
            station.lon = position.lon;
        }
        for (const direction of directions) {
            direction.calls = direction.calls.map((call) => ({
                ...call,
                ...(placed.get(call.id) ?? {}),
            }));
        }

        if (cfg.id === "A") {
            const airport = routeStops.find((stop) => stop.id === "A06");
            if (airport) airport.name = "Bandara Soekarno-Hatta";
        }
        const longName = cfg.longName;
        const variants = directions.map((direction, index) => ({
            ...routeVariant(cfg, direction, index),
            ...(cfg.mainDirections && index >= cfg.mainDirections
                ? { kind: "alihan" as const, via: "Nambo" }
                : {}),
        }));
        // After station placement, trim only the two terminal overhangs. The
        // Tangerang relation continues to buffer-stop tracks past both ends;
        // keeping those made the brown line overshoot its station markers.
        const trimmedDirections = directions.map((direction) => {
            const terminals = direction.calls.filter(
                (_, i) => i === 0 || i === direction.calls.length - 1
            );
            return terminals.length === 2
                ? { ...direction, line: trimLineToStops(direction.line, terminals) }
                : direction;
        });
        const geometryByShape = Object.fromEntries(
            trimmedDirections.map((direction, index) => {
                const terminals = direction.calls.filter((call, i) => i === 0 || i === direction.calls.length - 1);
                // A racket starts and ends at the same station; trimming that
                // would erase the entire loop. Only cut distinct terminal
                // stops (Duri�Tangerang and similar open lines).
                const openRoute = terminals.length === 2 && terminals[0].id !== terminals[1].id;
                const trimmed = openRoute
                    ? trimLineToStops(direction.line, terminals)
                    : direction.line;
                return [
                    `${cfg.id}-${index}`,
                    trimmed.map(([lon, lat]) => [round(lon), round(lat)] as LngLat),
                ];
            })
        );
        const detail = {
            route_id: cfg.id,
            route_short_name: cfg.short,
            route_long_name: longName,
            route_color: cfg.color,
            stops: routeStops.map((stop) => ({
                stop_id: stop.id,
                stop_name: stop.name,
                stop_lat: round(stop.lat),
                stop_lon: round(stop.lon),
                sequence: stop.sequence,
            })),
            variants,
            geometryByShape,
        };
        outputFiles.set(path.join("routes", `${encodeURIComponent(cfg.id)}.json`), detail);
        routeIndex.push({
            route_id: cfg.id,
            route_short_name: cfg.short,
            route_long_name: longName,
            route_desc: "KRL",
            route_color: cfg.color,
            route_text_color: "FFFFFF",
        });
        addToStationIndex(stationAggregate, cfg.id, cfg.color, routeStops);

        // TP uses one shared corridor. C has two complete full-racket shapes,
        // both of which belong in the city-wide overview by default.
        const overviewDirections = cfg.id === "C"
            ? trimmedDirections
            : cfg.mainDirections
              ? [trimmedDirections[0], trimmedDirections[cfg.mainDirections]]
              : trimmedDirections.slice(0, 1);
        for (const direction of overviewDirections) {
            const duri = routeStops.find((stop) => stop.name === "Duri");
            const manggarai = stationAggregate.find((station) => station.name === "Manggarai");
            const bogorStop = cfg.id === "A"
                ? [106.849688, -6.210358] as LngLat
                : null;
            const cikarangStop = manggarai?.anchors.find((anchor) => anchor.routeId === "C");
            const manggaraiDisplay = bogorStop && cikarangStop
                ? airportManggaraiDisplayPoint([
                    { routeId: "B", lon: bogorStop[0], lat: bogorStop[1] },
                    cikarangStop,
                ])
                : null;
            const displayLines = cfg.id === "A" && duri && manggaraiDisplay
                ? airportDisplayLine(direction.line,
                    [duri.lon, duri.lat], manggaraiDisplay)
                : [direction.line];
            for (const displayLine of displayLines) overviewFeatures.push({
                type: "Feature",
                properties: {
                    color: `#${cfg.color}`,
                    opacity: 1,
                    width: 3,
                    ...(cfg.id === "A"
                        ? { lineOffset: airportLineOffset(cfg.id, direction.line) }
                        : {}),
                },
                geometry: {
                    type: "LineString",
                    coordinates: displayLine.map(([lon, lat]) => [round(lon), round(lat)]),
                },
            });
        }

        console.log(
            `  ${cfg.id}: ${routeStops.length} physical stations; ` +
                variants.map((variant) => `${variant.stopCount} ordered calls`).join(", ") +
                `; track ${directions.map((d) => (lengthM(d.line) / 1000).toFixed(1)).join("/")} km`
        );
    }

    const stationIndex = stationAggregate.map((station) => ({
        id: `${station.name}@${station.lat.toFixed(5)},${station.lon.toFixed(5)}`,
        name: station.name,
        lat: round(station.lat),
        lon: round(station.lon),
        platforms: 1,
        routes: [...station.routes].sort(),
        positions: station.positions,
        ...(station.anchors.length > 1
            ? { anchors: station.anchors.map((anchor) => ({
                  ...anchor,
                  lat: round(anchor.lat),
                  lon: round(anchor.lon),
              })) }
            : {}),
    }));
    outputFiles.set("routes.json", routeIndex);
    outputFiles.set("stops.json", stationIndex);
    outputFiles.set("stops-geo.json", {
        type: "FeatureCollection",
        features: stationIndex.map((station) => ({
            type: "Feature",
            properties: {
                name: station.name,
                routes: station.routes.length,
                stationId: station.id,
                ...(station.anchors ? { anchors: station.anchors } : {}),
            },
            geometry: { type: "Point", coordinates: [station.lon, station.lat] },
        })),
    });
    outputFiles.set("overview.json", {
        type: "FeatureCollection",
        features: overviewFeatures,
    });
    outputFiles.set(".meta.json", {
        source: "OpenStreetMap relation full API + Overpass station nodes",
        attribution: "© OpenStreetMap contributors",
        osmTimestamp: stationData.timestamp,
        syncedAt: new Date().toISOString(),
        relations: LINES.flatMap((line) => line.relations),
        deferredRelations: [15097496, 15097497, 15097498, 15097499, 15097500, 15097501, 15097502, 15097503, 15097504, 15097505, 15097506, 15097507],
    });

    // Interchanges can connect two or three lines. Validate known shared
    // stations rather than assuming a fixed global count as lines are added.
    if (stationIndex.length < 60) {
        throw new Error(`Expected at least 60 physical KRL stations, got ${stationIndex.length}`);
    }
    const cStations = stationIndex.filter((station) => station.routes.includes("C"));
    if (cStations.length !== 26) {
        throw new Error(`Expected 26 unique C stations, got ${cStations.length}`);
    }
    const cRoute = outputFiles.get(path.join("routes", "C.json")) as { variants: { stopIds: string[] }[] };
    for (const variant of cRoute.variants) {
        if (variant.stopIds[0] !== "C26" || variant.stopIds.at(-1) !== "C26") {
            throw new Error("C full racket does not start and end at C26");
        }
    }
    const shared = stationIndex.filter(
        (station) => station.name === "Kampung Bandan" && station.routes.includes("C") && station.routes.includes("TP")
    );
    if (shared.length !== 1) throw new Error("Kampung Bandan was not unified between TP and C");
    const duri = stationIndex.filter(
        (station) => station.name === "Duri" && station.routes.includes("C") && station.routes.includes("T")
    );
    if (duri.length !== 1) throw new Error("Duri was not unified between C and T");
    const tRoute = outputFiles.get(path.join("routes", "T.json")) as {
        stops: { stop_id: string }[];
        variants: { stopIds: string[] }[];
    };
    if (
        tRoute.stops.length !== 11 ||
        tRoute.variants.length !== 2 ||
        tRoute.variants[0].stopIds[0] !== "T01" ||
        tRoute.variants[0].stopIds.at(-1) !== "T11" ||
        tRoute.variants[1].stopIds[0] !== "T11" ||
        tRoute.variants[1].stopIds.at(-1) !== "T01"
    ) throw new Error("Tangerang line must have both 11-stop Duri–Tangerang directions");
    const bogor = outputFiles.get(path.join("routes", "B.json")) as {
        stops: { stop_id: string; stop_name: string }[];
        variants: { stopIds: string[] }[];
    };
    if (!bogor || bogor.variants.length !== 4 ||
        !bogor.stops.some((station) => station.stop_name === "Bogor") ||
        !bogor.stops.some((station) => station.stop_name === "Nambo") ||
        bogor.variants[0].stopIds[0] !== "B01" ||
        bogor.variants[0].stopIds.at(-1) !== "B26" ||
        bogor.variants[1].stopIds[0] !== "B26" ||
        bogor.variants[1].stopIds.at(-1) !== "B01"
    ) throw new Error("Bogor line must include both Bogor and Nambo branches");
    const airport = outputFiles.get(path.join("routes", "A.json")) as {
        stops: { stop_id: string; stop_name: string }[];
        variants: { stopIds: string[]; headsign: string }[];
    };
    const airportIds = ["A01", "A02", "A03", "A04", "A05", "A06"];
    if (!airport || airport.stops.length !== 6 || airport.variants.length !== 2 ||
        airport.stops.map((stop) => stop.stop_id).join() !== airportIds.join() ||
        airport.variants[0].stopIds.join() !== airportIds.join() ||
        airport.variants[1].stopIds.join() !== [...airportIds].reverse().join() ||
        airport.stops.at(-1)?.stop_name !== "Bandara Soekarno-Hatta" ||
        stationIndex.filter((station) => station.routes.includes("A")).length !== 6 ||
        stationIndex.filter((station) => station.name === "Manggarai" &&
            station.routes.includes("A") && station.routes.includes("B") && station.routes.includes("C")).length !== 1
    ) throw new Error("Airport line must serve six stops in both directions and share Manggarai");
    const senen = cRoute.variants.map((variant) => variant.stopIds.includes("C04"));
    if (senen[0] !== true || senen[1] !== false) {
        throw new Error("Pasar Senen must only be a stop on the via Pasar Senen racket");
    }

    // Stage every file before changing the live dataset. Once staged, swap
    // the directory in one step; replacing files one by one could leave an
    // index advertising C while routes/C.json is still missing. Keep the old
    // directory until the new one is in place so a failed swap is recoverable.
    const tempDir = `${OUT_DIR}.tmp-${process.pid}`;
    const backupDir = `${OUT_DIR}.bak-${process.pid}`;
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(path.join(tempDir, "routes"), { recursive: true });
    try {
        for (const [relative, value] of outputFiles) {
            const target = path.join(tempDir, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await writeJson(target, value, relative === ".meta.json");
        }
        await fs.rm(backupDir, { recursive: true, force: true });
        const hadPrevious = await fs
            .access(OUT_DIR)
            .then(() => true)
            .catch(() => false);
        if (hadPrevious) await fs.rename(OUT_DIR, backupDir);
        try {
            await fs.rename(tempDir, OUT_DIR);
        } catch (error) {
            if (hadPrevious) await fs.rename(backupDir, OUT_DIR);
            throw error;
        }
        if (hadPrevious) await fs.rm(backupDir, { recursive: true, force: true });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }

    console.log(`✓ Baked ${routeIndex.length} lines and ${stationIndex.length} stations`);
}

main().catch((error) => {
    console.error("✗ KRL sync failed:", error);
    process.exitCode = 1;
});
