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

// ---------------------------------------------------------------------------
// Configuration

interface LineConfig {
    id: string;
    short: string;
    color: string;
    relations: number[];
    oneWay?: Record<string, number>;
    canonicalByName?: Record<string, string>;
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
        canonicalByName: C_STATIONS,
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
const STATION_BBOX = "-6.28,106.79,-6.10,107.17";
const MAX_JOIN_GAP_M = 20;
const STATION_MATCH_M = 1000;
const CLUSTER_M = 100;
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
                    if (named.has("Jakarta Kota") && named.has("Cikarang")) {
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
        // TP's relation members are not in travel order. Reconnect ways at
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

function gather(
    cfg: LineConfig,
    relation: OsmRelation,
    nodes: Map<number, OsmNode>,
    ways: Map<number, OsmWay>
): Direction {
    const line = chainWays(relation, ways, nodes, cfg.id === "C");
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
    if (calls.length < 2) throw new Error(`Relation ${relation.id}: fewer than two stops`);

    const endpointA = project(line, [calls[0].lon, calls[0].lat]).off;
    const endpointZ = project(line, [calls.at(-1)!.lon, calls.at(-1)!.lat]).off;
    if (endpointA > 250 || endpointZ > 250) {
        throw new Error(
            `Relation ${relation.id}: stop is ${Math.max(endpointA, endpointZ).toFixed(0)}m off chained track`
        );
    }
    return { relation, line, calls };
}

function locate(
    station: StationCall,
    line: LngLat[],
    stationNodes: OsmNode[]
): { lat: number; lon: number; nodeId: number } {
    const here: LngLat = [station.lon, station.lat];
    const key = nameKey(station.name);
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
    if (cfg.id === "C") {
        list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
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
    const finalName = cfg.id === "C" ? "Cikarang" : direction.calls.at(-1)!.name;
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
}

function addToStationIndex(
    aggregate: AggregateStation[],
    routeId: string,
    stops: RouteStation[]
) {
    for (const stop of stops) {
        const hit = aggregate.find(
            (candidate) =>
                nameKey(candidate.name) === nameKey(stop.name) &&
                metres([candidate.lon, candidate.lat], [stop.lon, stop.lat]) <= CLUSTER_M
        );
        if (hit) {
            // Keep the first line's snapped marker, rather than averaging
            // coordinates on two different tracks. TP is processed first:
            // its Kampung Bandan marker remains on the TP line, while C's
            // route detail keeps its own pin on the C track.
            hit.count++;
            hit.routes.add(routeId);
            hit.positions[routeId] ??= [stop.sequence, stops.length];
        } else {
            aggregate.push({
                name: stop.name,
                lat: stop.lat,
                lon: stop.lon,
                count: 1,
                routes: new Set([routeId]),
                positions: { [routeId]: [stop.sequence, stops.length] },
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
            const position = locate(station, directions[0].line, stationData.nodes);
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

        const longName = cfg.id === "C" ? "Cikarang - Kampung Bandan" : "Jakarta Kota - Tanjung Priuk";
        const variants = directions.map((direction, index) => routeVariant(cfg, direction, index));
        const geometryByShape = Object.fromEntries(
            directions.map((direction, index) => [
                `${cfg.id}-${index}`,
                direction.line.map(([lon, lat]) => [round(lon), round(lat)] as LngLat),
            ])
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
        addToStationIndex(stationAggregate, cfg.id, routeStops);

        // TP uses one shared corridor. C has two complete full-racket shapes,
        // both of which belong in the city-wide overview by default.
        const overviewDirections = cfg.id === "C" ? directions : directions.slice(0, 1);
        for (const direction of overviewDirections) {
            overviewFeatures.push({
                type: "Feature",
                properties: { color: `#${cfg.color}`, opacity: 1, width: 3 },
                geometry: {
                    type: "LineString",
                    coordinates: direction.line.map(([lon, lat]) => [round(lon), round(lat)]),
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
    }));
    outputFiles.set("routes.json", routeIndex);
    outputFiles.set("stops.json", stationIndex);
    outputFiles.set("stops-geo.json", {
        type: "FeatureCollection",
        features: stationIndex.map((station) => ({
            type: "Feature",
            properties: { name: station.name, routes: station.routes.length },
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

    if (stationIndex.length !== 30) {
        throw new Error(`Expected 30 physical stations (26 C + 5 TP - shared Kampung Bandan), got ${stationIndex.length}`);
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
