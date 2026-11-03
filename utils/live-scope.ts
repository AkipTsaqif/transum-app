import type { LiveBounds, LiveScope, LiveVehicle } from "./types/live";

/** No unrestricted fleet request: a known route or finite local viewport is required. */
export function parseLiveScope(
  params: URLSearchParams,
  knownRoutes: ReadonlySet<string>,
): LiveScope | null {
  if (params.getAll("route").length > 1 || params.getAll("bbox").length > 1)
    return null;
  const route = params.get("route");
  const raw = params.get("bbox");
  if (route !== null)
    return route && knownRoutes.has(route) && raw === null
      ? { routeId: route, bounds: null }
      : null;
  if (!raw || raw.split(",").length !== 4) return null;
  const parts = raw.split(",");
  if (parts.some((p) => !p.trim())) return null;
  const [west, south, east, north] = parts.map(Number);
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west >= east ||
    south >= north ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    east - west > 5 ||
    north - south > 5
  )
    return null;
  return { routeId: null, bounds: [west, south, east, north] };
}
export const liveScopeQuery = (scope: LiveScope): string =>
  scope.routeId !== null
    ? `route=${encodeURIComponent(scope.routeId)}`
    : scope.bounds
      ? `bbox=${scope.bounds.join(",")}`
      : "";
export function vehicleInScope(v: LiveVehicle, scope: LiveScope): boolean {
  if (scope.routeId !== null) return v.routeId === scope.routeId;
  if (!scope.bounds) return false;
  const [w, s, e, n] = scope.bounds;
  return (
    v.longitude >= w && v.longitude <= e && v.latitude >= s && v.latitude <= n
  );
}
const area = (b: LiveBounds) => (b[2] - b[0]) * (b[3] - b[1]);
const contains = (outer: LiveBounds, inner: LiveBounds) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3];

/** Grid the requested area snaps to, in degrees (~1.1 km). */
export const LIVE_REQUEST_GRID = 0.01;
/** Margin requested around the visible map, as a fraction of its size per side. */
export const LIVE_REQUEST_PADDING = 0.5;
/**
 * Keep the current area while it is at most this many times larger than a
 * fresh request would be. Zooming in further than that asks for a tighter
 * area, so a street-level view never streams the whole city.
 */
export const LIVE_REQUEST_MAX_GROWTH = 4;

/**
 * The area to stream for a settled viewport.
 *
 * Requesting exactly the visible map meant every pan, however small, became a
 * new subscription: the stream closed, the buses blinked out and the panel
 * showed "Menghubungkan" again. Instead the request is padded and snapped to
 * a grid, and an existing request is kept for as long as it still covers the
 * view. Panning within the margin changes nothing at all.
 */
export function liveRequestBounds(
  viewport: LiveBounds,
  current: LiveBounds | null,
): LiveBounds {
  const view = settledLiveBounds(viewport);
  const padLon = (view[2] - view[0]) * LIVE_REQUEST_PADDING;
  const padLat = (view[3] - view[1]) * LIVE_REQUEST_PADDING;
  const g = LIVE_REQUEST_GRID;
  const snap = (v: number, up: boolean) =>
    Number(((up ? Math.ceil(v / g) : Math.floor(v / g)) * g).toFixed(4));
  const fresh = settledLiveBounds([
    snap(view[0] - padLon, false),
    snap(view[1] - padLat, false),
    snap(view[2] + padLon, true),
    snap(view[3] + padLat, true),
  ]);
  if (
    current &&
    contains(current, view) &&
    area(current) <= area(fresh) * LIVE_REQUEST_MAX_GROWTH
  )
    return current;
  return fresh;
}

/**
 * Vehicles worth keeping on screen while a new viewport stream connects.
 *
 * Only between two viewport scopes: a bus from the old area that is inside the
 * new one is still a real observation of that area. Switching to or from a
 * route never carries anything over, so a selected corridor can't briefly show
 * another route's buses.
 */
export function carryOverVehicles(
  previous: { scope: LiveScope; vehicles: LiveVehicle[] } | null,
  next: LiveScope,
): LiveVehicle[] {
  if (!previous || next.routeId !== null || !next.bounds) return [];
  if (previous.scope.routeId !== null || !previous.scope.bounds) return [];
  return previous.vehicles.filter((v) => vehicleInScope(v, next));
}

/** Quantized at map-idle, not every animation frame; preserve a bounded query. */
export function settledLiveBounds(bounds: LiveBounds): LiveBounds {
  // The live network is local. A zoomed-out world view must not turn into an
  // unbounded fleet request (or an invalid >5-degree bbox retry loop).
  const centerLon = (bounds[0] + bounds[2]) / 2;
  const centerLat = (bounds[1] + bounds[3]) / 2;
  const halfLon = Math.min(2.49, (bounds[2] - bounds[0]) / 2);
  const halfLat = Math.min(2.49, (bounds[3] - bounds[1]) / 2);
  return [
    Math.max(-180, centerLon - halfLon),
    Math.max(-90, centerLat - halfLat),
    Math.min(180, centerLon + halfLon),
    Math.min(90, centerLat + halfLat),
  ].map((v) => Number(v.toFixed(4))) as LiveBounds;
}
