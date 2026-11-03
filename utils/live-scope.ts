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
