import type { RouteDetail } from "./types/gtfs";
import type { LngLat } from "./live-path";

/**
 * Shape lookup for live vehicles.
 *
 * Generic: it maps a vehicle's trip to the polyline it drives, from whatever
 * route detail is loaded. Nothing here knows about Transjakarta, MQTT or SSE,
 * so any feed that carries a trip id can reuse it.
 */

export interface RouteShapes {
  /** trip_id -> shape_id, from the route's baked variants. */
  trips: Map<string, string>;
  /** shape_id -> coordinates. */
  shapes: Record<string, LngLat[]>;
}

/** How many routes to keep; live viewport mode may touch many briefly. */
export const LIVE_SHAPE_CACHE_ROUTES = 40;

export function indexRouteShapes(detail: RouteDetail): RouteShapes {
  const trips = new Map<string, string>();
  for (const variant of detail.variants ?? [])
    if (variant.trip_id && variant.shape_id)
      trips.set(variant.trip_id, variant.shape_id);
  const shapes: Record<string, LngLat[]> = {};
  for (const [id, coordinates] of Object.entries(detail.geometryByShape ?? {}))
    if (coordinates?.length > 1) shapes[id] = coordinates;
  return { trips, shapes };
}

/**
 * Bounded cache of route shapes with a trip lookup.
 *
 * Resolution deliberately returns `null` rather than guessing: a route with
 * several shapes tells us nothing about which one a trip uses, and following
 * the wrong one would draw a bus on the other side of the city. Callers then
 * fall back to a straight-line glide.
 */
export class LiveShapeIndex {
  private routes = new Map<string, RouteShapes>();
  constructor(private limit = LIVE_SHAPE_CACHE_ROUTES) {}

  get size(): number {
    return this.routes.size;
  }
  has(routeId: string): boolean {
    return this.routes.has(routeId);
  }
  /** Insert or refresh; reinsertion keeps recently used routes off the chopping block. */
  set(routeId: string, detail: RouteDetail): void {
    this.delete(routeId);
    this.routes.set(routeId, indexRouteShapes(detail));
    while (this.routes.size > this.limit) {
      const oldest = this.routes.keys().next().value;
      if (oldest === undefined) break;
      this.routes.delete(oldest);
    }
  }
  delete(routeId: string): void {
    this.routes.delete(routeId);
  }
  clear(): void {
    this.routes.clear();
  }

  /** The polyline a trip drives, or null when it cannot be known. */
  resolve(routeId: string, tripId: string): LngLat[] | null {
    const route = this.routes.get(routeId);
    if (!route) return null;
    // Keep the route warm on use.
    this.routes.delete(routeId);
    this.routes.set(routeId, route);

    const shapeId = tripId ? route.trips.get(tripId) : undefined;
    if (shapeId) return route.shapes[shapeId] ?? null;
    // Unambiguous only when the route has exactly one shape at all.
    const ids = Object.keys(route.shapes);
    return ids.length === 1 ? route.shapes[ids[0]] : null;
  }
}
