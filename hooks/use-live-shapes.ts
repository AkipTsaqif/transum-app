"use client";
import { useCallback, useEffect, useRef } from "react";
import type { RouteDetail } from "@/utils/types/gtfs";
import type { LiveVehicle } from "@/utils/types/live";
import type { ShapeFor } from "@/utils/live-motion";
import type { LngLat } from "@/utils/live-path";
import { LiveShapeIndex } from "@/utils/live-shapes";

/** Same reasoning as the page: baked data only changes at deploy. */
const NO_CACHE_IN_DEV: RequestInit =
  process.env.NODE_ENV === "production" ? {} : { cache: "no-store" };

/** Shapes are only worth downloading once the glide is actually visible. */
export const LIVE_SHAPES_MIN_ZOOM = 12;
const CONCURRENCY = 4;

/**
 * Supply the road geometry each live vehicle is driving, so the motion engine
 * can follow it instead of cutting corners.
 *
 * - The selected route's detail is already on the page: reuse it, no request.
 * - Viewport mode fetches the detail of routes that currently have vehicles,
 *   only above `LIVE_SHAPES_MIN_ZOOM`, at most four at a time, cached per
 *   session and bounded by `LiveShapeIndex`.
 * - Anything unresolved returns null and the caller draws a straight line.
 */
export function useLiveShapes(options: {
  vehicles: LiveVehicle[];
  zoom: number;
  enabled: boolean;
  selectedRouteId: string | null;
  selectedDetail: RouteDetail | null;
}): ShapeFor {
  const { vehicles, zoom, enabled, selectedRouteId, selectedDetail } = options;
  const index = useRef(new LiveShapeIndex());
  const inFlight = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const abort = useRef<AbortController | null>(null);

  // The page already has this route's geometry; never pay for it twice.
  useEffect(() => {
    if (selectedDetail && selectedDetail.route_id === selectedRouteId)
      index.current.set(selectedDetail.route_id, selectedDetail);
  }, [selectedDetail, selectedRouteId]);

  useEffect(() => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    return () => {
      ctrl.abort();
      abort.current = null;
      inFlight.current.clear();
      queue.current = [];
      active.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!enabled || zoom < LIVE_SHAPES_MIN_ZOOM) return;
    const wanted = new Set(vehicles.map((v) => v.routeId));
    for (const routeId of wanted) {
      if (index.current.has(routeId) || inFlight.current.has(routeId)) continue;
      if (!queue.current.includes(routeId)) queue.current.push(routeId);
    }

    const pump = () => {
      while (active.current < CONCURRENCY && queue.current.length) {
        const routeId = queue.current.shift()!;
        const ctrl = abort.current;
        if (!ctrl || ctrl.signal.aborted) return;
        if (index.current.has(routeId)) continue;
        inFlight.current.add(routeId);
        active.current++;
        void fetch(`/api/gtfs/routes/${encodeURIComponent(routeId)}`, {
          ...NO_CACHE_IN_DEV,
          signal: ctrl.signal,
        })
          .then(async (res) => {
            if (!res.ok) return;
            const detail = (await res.json()) as RouteDetail;
            // Only keep it if it is still a route we asked for.
            if (detail?.route_id === routeId)
              index.current.set(routeId, detail);
          })
          .catch(() => {
            // A failed shape is not an error the user must see: the glide
            // simply stays straight for that route.
          })
          .finally(() => {
            inFlight.current.delete(routeId);
            active.current--;
            pump();
          });
      }
    };
    pump();
  }, [vehicles, zoom, enabled]);

  return useCallback<ShapeFor>((vehicle: LiveVehicle): LngLat[] | null => {
    const shapes = index.current.resolve(vehicle.routeId, vehicle.tripId);
    if (!shapes) return null;
    // Refresh LRU ordering on use.
    return shapes;
  }, []);
}
