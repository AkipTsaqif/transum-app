"use client";
import { useCallback, useEffect, useRef } from "react";
import type { RouteDetail } from "@/utils/types/gtfs";
import type { LiveVehicle } from "@/utils/types/live";
import type { ShapeFor } from "@/utils/live-motion";
import { LiveShapeIndex } from "@/utils/live-shapes";
import { LiveShapeRequests } from "@/utils/live-shape-requests";

const NO_CACHE_IN_DEV: RequestInit =
  process.env.NODE_ENV === "production" ? {} : { cache: "no-store" };
export const LIVE_SHAPES_MIN_ZOOM = 12;
const CONCURRENCY = 4;

/** Bounded shape loading. Snapshot ticks neither retry failures nor churn the LRU. */
export function useLiveShapes(options: {
  vehicles: LiveVehicle[];
  zoom: number;
  enabled: boolean;
  selectedRouteId: string | null;
  selectedDetail: RouteDetail | null;
}): ShapeFor {
  const { vehicles, zoom, enabled, selectedRouteId, selectedDetail } = options;
  const index = useRef(new LiveShapeIndex());
  const policy = useRef(new LiveShapeRequests());
  const wantedIds =
    enabled && zoom >= LIVE_SHAPES_MIN_ZOOM
      ? [...new Set(vehicles.map((v) => v.routeId))].sort()
      : [];
  const wantedKey = JSON.stringify(wantedIds);
  const fetchTasks = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (selectedDetail && selectedDetail.route_id === selectedRouteId)
      index.current.set(selectedDetail.route_id, selectedDetail);
  }, [selectedDetail, selectedRouteId]);

  useEffect(() => {
    const wanted = JSON.parse(wantedKey) as string[];
    if (!wanted.length) return;
    const ctrl = new AbortController();
    let queue: string[] = [];
    let active = 0;
    const refill = () => {
      if (ctrl.signal.aborted) return;
      queue = policy.current
        .select(wanted, Date.now())
        .filter((id) => !index.current.has(id) && !fetchTasks.current.has(id));
      pump();
    };
    const pump = () => {
      while (!ctrl.signal.aborted && active < CONCURRENCY && queue.length) {
        const routeId = queue.shift()!;
        if (index.current.has(routeId) || fetchTasks.current.has(routeId))
          continue;
        active++;
        const task = fetch(`/api/gtfs/routes/${encodeURIComponent(routeId)}`, {
          ...NO_CACHE_IN_DEV,
          signal: ctrl.signal,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error("Shape unavailable");
            const detail = (await res.json()) as RouteDetail;
            if (ctrl.signal.aborted) return;
            if (detail?.route_id !== routeId) throw new Error("Wrong route");
            index.current.set(routeId, detail);
          })
          .catch(() => {
            if (!ctrl.signal.aborted)
              policy.current.failed(routeId, Date.now());
          })
          .finally(() => {
            if (fetchTasks.current.get(routeId) === task)
              fetchTasks.current.delete(routeId);
            active--;
            if (!ctrl.signal.aborted) pump();
          });
        fetchTasks.current.set(routeId, task);
      }
    };
    refill();
    // Cooldown retry and recovery after an aborted obsolete request. Never one
    // request per source snapshot; at most one failed retry each 30 seconds.
    const retry = setInterval(refill, 30_000);
    return () => {
      ctrl.abort();
      queue = [];
      clearInterval(retry);
    };
  }, [wantedKey]);

  return useCallback<ShapeFor>(
    (vehicle) => index.current.resolve(vehicle.routeId, vehicle.tripId),
    [],
  );
}
