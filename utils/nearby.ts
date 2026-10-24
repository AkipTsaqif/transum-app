import type { TransitMode } from "@/lib/gtfs";
import { routeKey } from "./all-modes";
import type { RouteSummary } from "./types/gtfs";

/**
 * Cross-system walking transfers.
 *
 * A stop's own route list answers "what calls here". This answers the other
 * question: "where can I change?" -- stops of a different service within a
 * short walk, which is what turns five separate mode views into one journey.
 *
 * Two rules, confirmed with the owner:
 *
 *  1. A nearby stop is listed only for routes the clicked stop does not
 *     already serve. A strict "different mode" rule would hide BNI City from
 *     Sudirman even though it is the airport line's interchange, so the unit
 *     is the SERVICE (route), not the dataset.
 *  2. When several stops serve the same route, only the closest one lists it.
 *     Around Dukuh Atas six bus stops overlap on 1B/1P/4C/9D; without this
 *     the suggestion list is the same route repeated five times.
 *
 * Distances are straight-line metres, not walking-network metres: an off-ramp
 * or a canal can make a 300 m neighbour unreachable on foot. The UI must say
 * "sekitar", never promise a walk time.
 */

/** Radius of a "short walk" here. Covers the whole Dukuh Atas complex. */
export const WALKING_RADIUS_M = 500;

export interface NearbyStation {
  mode: TransitMode;
  name: string;
  lat: number;
  lon: number;
  /** Straight-line metres from the clicked station. */
  distance: number;
  routes: RouteSummary[];
}

export interface NearbyConnection {
  mode: TransitMode;
  name: string;
  lat: number;
  lon: number;
  distance: number;
  /** Only the routes this stop is the CLOSEST provider of. */
  routes: RouteSummary[];
}

export interface ClickedStation {
  mode: TransitMode;
  name: string;
  lat: number;
  lon: number;
  routes: RouteSummary[];
}

/**
 * Nearby stops worth suggesting, closest first.
 *
 * Every route in reach is claimed by its closest stop; the clicked station
 * claims its own routes at distance zero. A stop is dropped entirely when all
 * of its routes are claimed elsewhere, and keeps only the routes nobody
 * closer serves. `candidates` need not be sorted; duplicates of the clicked
 * stop itself (under a metre) are ignored.
 */
export function walkingConnections(
  clicked: ClickedStation,
  candidates: NearbyStation[],
  radiusM: number = WALKING_RADIUS_M,
): NearbyConnection[] {
  const claimed = new Set(
    clicked.routes.map((route) => routeKey(clicked.mode, route.route_id)),
  );
  const inRange = candidates
    .filter(
      (candidate) =>
        candidate.distance > SAME_PLACE_M && candidate.distance <= radiusM,
    )
    .sort((a, b) => a.distance - b.distance);

  // One row per PLACE, not per operator record: two operators mapping the
  // same physical stop produce two stations a few metres apart, which used to
  // show as two identical rows. Routes keep their mode while merging, because
  // the same id in two systems is two different services.
  const groups: {
    name: string;
    lat: number;
    lon: number;
    distance: number;
    mode: TransitMode;
    routes: { mode: TransitMode; route: RouteSummary }[];
  }[] = [];
  for (const candidate of inRange) {
    const group = groups.find(
      (g) => g.name === candidate.name && metresWithin(g, candidate),
    );
    const entries = candidate.routes.map((route) => ({
      mode: candidate.mode,
      route,
    }));
    if (group) {
      group.distance = Math.min(group.distance, candidate.distance);
      for (const entry of entries) {
        if (
          !group.routes.some(
            (r) =>
              r.mode === entry.mode && r.route.route_id === entry.route.route_id,
          )
        ) {
          group.routes.push(entry);
        }
      }
      continue;
    }
    groups.push({
      name: candidate.name,
      lat: candidate.lat,
      lon: candidate.lon,
      distance: candidate.distance,
      mode: candidate.mode,
      routes: entries,
    });
  }

  // Closest place per service. Ties keep the first, so the result does not
  // depend on how the API happened to order two equidistant stops.
  const closest = new Map<string, number>();
  for (const group of groups) {
    for (const { mode, route } of group.routes) {
      const key = routeKey(mode, route.route_id);
      const best = closest.get(key);
      if (best === undefined || group.distance < best) {
        closest.set(key, group.distance);
      }
    }
  }

  const connections: NearbyConnection[] = [];
  for (const group of groups) {
    const kept = group.routes.filter(({ mode, route }) => {
      const key = routeKey(mode, route.route_id);
      return !claimed.has(key) && closest.get(key) === group.distance;
    });
    if (!kept.length) continue;
    connections.push({
      mode: group.mode,
      name: group.name,
      lat: group.lat,
      lon: group.lon,
      distance: group.distance,
      routes: kept.map((entry) => entry.route),
    });
  }
  return connections.sort((a, b) => a.distance - b.distance);
}

/** Same physical place: same name and within `SAME_PLACE_M` of each other. */
const metresWithin = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) =>
  Math.hypot(
    (a.lon - b.lon) * 111_320 * Math.cos(((a.lat + b.lat) * Math.PI) / 360),
    (a.lat - b.lat) * 110_540,
  ) <= SAME_PLACE_M;

/**
 * "Same place", as opposed to "a short walk away".
 *
 * Operators rarely share a stop *object* in OSM: Terminal Leuwipanjang exists
 * once per operator's route relations, sometimes a few metres apart. Below
 * this radius the stops are one interchange, so their lines belong on the
 * same card instead of being presented as somewhere to walk to.
 *
 * Kept under `WALKING_RADIUS_M` so the two lists never overlap.
 */
export const SAME_PLACE_M = 40;

export interface SamePlaceService {
  mode: TransitMode;
  name: string;
  lat: number;
  lon: number;
  distance: number;
  /** Services here that the clicked stop does not already serve. */
  routes: RouteSummary[];
}

/**
 * Extra operator lines that call at the SAME stop as the one clicked.
 *
 * `walkingConnections` deliberately ignores stops under a metre away (they are
 * the clicked stop itself) and treats everything else as a transfer. That
 * leaves a multi-operator terminal looking like it only serves one operator,
 * which is exactly the confusion this list fixes. Rules match the transfer
 * list: never repeat a route the clicked stop already serves, and let the
 * closest stop claim a route.
 */
export function samePlaceServices(
  clicked: ClickedStation,
  candidates: NearbyStation[],
  radiusM: number = SAME_PLACE_M,
): SamePlaceService[] {
  const claimed = new Set(
    clicked.routes.map((route) => routeKey(clicked.mode, route.route_id)),
  );
  const inRange = candidates.filter(
    (candidate) =>
      candidate.distance <= radiusM &&
      // The clicked stop's own record, not a neighbouring platform.
      !(
        candidate.mode === clicked.mode &&
        candidate.name === clicked.name &&
        candidate.distance <= 1
      ),
  );

  const closest = new Map<string, number>();
  for (const candidate of inRange) {
    for (const route of candidate.routes) {
      const key = routeKey(candidate.mode, route.route_id);
      const best = closest.get(key);
      if (best === undefined || candidate.distance < best) {
        closest.set(key, candidate.distance);
      }
    }
  }

  const services: SamePlaceService[] = [];
  for (const candidate of inRange) {
    const routes = candidate.routes.filter((route) => {
      const key = routeKey(candidate.mode, route.route_id);
      return !claimed.has(key) && closest.get(key) === candidate.distance;
    });
    if (!routes.length) continue;
    services.push({
      mode: candidate.mode,
      name: candidate.name,
      lat: candidate.lat,
      lon: candidate.lon,
      distance: candidate.distance,
      routes,
    });
  }
  return services.sort(
    (a, b) => a.distance - b.distance || a.name.localeCompare(b.name),
  );
}

/**
 * Split a connection's routes into the badges that fit and the rest.
 *
 * A row shows a couple of badges so the list stays scannable, but a stop can
 * contribute more services than that (Leuwipanjang brings several). The hidden
 * ones are kept intact for the expandable detail, never silently dropped.
 */
export function connectionRoutes(
  routes: RouteSummary[],
  limit: number,
): { shown: RouteSummary[]; hidden: RouteSummary[] } {
  const safe = Math.max(0, Math.trunc(limit));
  return { shown: routes.slice(0, safe), hidden: routes.slice(safe) };
}

/** [lon, lat] ring approximating a ground-radius circle around a point. */
export function walkRadiusRing(
  lat: number,
  lon: number,
  radiusM: number = WALKING_RADIUS_M,
  segments = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  // Flat-earth metres are plenty at 500 m and keep the ring closed exactly.
  const mPerDegLat = 110_540;
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    ring.push([
      lon + (radiusM * Math.cos(angle)) / mPerDegLon,
      lat + (radiusM * Math.sin(angle)) / mPerDegLat,
    ]);
  }
  return ring;
}

/**
 * Which corner of the card should touch the station.
 *
 * MapLibre anchors a popup by naming the part of it nearest the point, so the
 * named corner sits at the station and the card body covers the opposite
 * quadrant: `top-right` puts the card south-west of the pin.
 *
 * The corner is chosen by COUNTING how many transfer dots fall in the covered
 * quadrant, not by the cluster's average direction -- with the average, a
 * couple of near dots on the card's own side stayed hidden under it, and the
 * nearest transfer is exactly the one people need to see. Ties fall to the
 * centroid's opposite corner.
 */
export function connectionsAnchor(
  station: { lat: number; lon: number },
  connections: { lat: number; lon: number }[],
): "top-left" | "top-right" | "bottom-left" | "bottom-right" {
  if (!connections.length) return "top-right";
  const mPerDegLon = 111_320 * Math.cos((station.lat * Math.PI) / 180);
  // Bearing from the station, 0 = north, clockwise. The quadrant a card
  // covers is the quadrant OPPOSITE its anchor corner.
  const coveredQuadrant: Record<string, (bearing: number) => boolean> = {
    "bottom-right": (b) => b >= 270 || b < 0, // card north-west
    "top-right": (b) => b >= 180 && b < 270, // card south-west
    "bottom-left": (b) => b >= 0 && b < 90, // card north-east
    "top-left": (b) => b >= 90 && b < 180, // card south-east
  };
  const bearings = connections.map((c) => {
    const east = (c.lon - station.lon) * mPerDegLon;
    const north = (c.lat - station.lat) * 110_540;
    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  });

  const score = Object.entries(coveredQuadrant).map(([anchor, hidden]) => ({
    anchor,
    hidden: bearings.filter(hidden).length,
  }));
  const fewest = Math.min(...score.map((s) => s.hidden));
  const best = score.filter((s) => s.hidden === fewest).map((s) => s.anchor);

  // Tie-break: the corner opposite the centroid, so a symmetric cluster gets
  // a stable, sensible answer.
  const centre = connections.reduce(
    (acc, c) => ({
      lat: acc.lat + (c.lat - station.lat) / connections.length,
      lon: acc.lon + ((c.lon - station.lon) * mPerDegLon) / connections.length,
    }),
    { lat: 0, lon: 0 },
  );
  const preferred = `${centre.lat >= 0 ? "top" : "bottom"}-${
    centre.lon >= 0 ? "right" : "left"
  }` as const;
  return (best.includes(preferred) ? preferred : best[0]) as
    "top-left" | "top-right" | "bottom-left" | "bottom-right";
}
