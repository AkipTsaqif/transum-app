"use client";
import { useEffect, useRef, useState } from "react";
import { LiveMotion, type ShapeFor } from "@/utils/live-motion";
import { LIVE_STALE_MS, type LiveVehicle } from "@/utils/types/live";
import { LIVE_FRAME_MS, nextLivePaint } from "@/utils/live-frame";

/** Only above this zoom is a glide visible at all (35 m ~ 1.8 px at z12). */
export const LIVE_MOTION_MIN_ZOOM = 12;
/** Subpixel interpolation at up to 60 fps, independent of the feed's cadence. */
const FRAME_MS = LIVE_FRAME_MS;

/**
 * Identity of what React must render: membership plus anything that changes a
 * badge's appearance. Positions are deliberately excluded — those are pushed
 * straight to the map source every frame instead of through React state.
 */
const appearanceKey = (
  vehicles: LiveVehicle[],
  ages: Record<string, number>,
): string =>
  vehicles
    .map(
      (v) =>
        `${v.id}|${v.routeShortName}|${v.routeColor}|${v.routeTextColor}|${
          (ages[v.id] ?? 0) >= LIVE_STALE_MS ? 1 : 0
        }`,
    )
    .sort()
    .join(",");

/**
 * Smooth live markers without a React render per frame.
 *
 * The engine owns interpolation; this hook pushes sampled poses to `onFrame`
 * (a direct GeoJSON source update) at a capped rate. React state changes only
 * when the set of vehicles, their badges or their faded state changes.
 */
export function useLiveMotion(
  vehicles: LiveVehicle[],
  ages: Record<string, number>,
  options: {
    zoom: number;
    shapeFor?: ShapeFor;
    onFrame?: (frame: LiveVehicle[]) => void;
    minZoom?: number;
  },
) {
  const { zoom, shapeFor, onFrame, minZoom = LIVE_MOTION_MIN_ZOOM } = options;
  const engine = useRef(new LiveMotion());
  const inputs = useRef({ vehicles, ages });
  const [displayed, setDisplayed] = useState(vehicles);
  const shown = useRef(appearanceKey(vehicles, ages));
  const frame = useRef<number | null>(null);
  const tick = useRef<((time: number) => void) | null>(null);
  const reducedMotion = useRef(false);
  const live = useRef({ zoom, shapeFor, onFrame, minZoom });
  live.current = { zoom, shapeFor, onFrame, minZoom };

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = preference.matches;
    let lastPaint = -Infinity;

    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };

    /** Publish the current samples and re-render only if appearance changed. */
    const publish = (now: number) => {
      const sampled = engine.current.sample(now);
      live.current.onFrame?.(sampled);
      const key = appearanceKey(sampled, inputs.current.ages);
      if (key !== shown.current) {
        shown.current = key;
        setDisplayed(sampled);
      }
    };

    const syncReact = (now: number) => {
      const sampled = engine.current.sample(now);
      shown.current = appearanceKey(sampled, inputs.current.ages);
      setDisplayed(sampled);
      live.current.onFrame?.(sampled);
    };

    const reset = () => {
      cancel();
      const now = performance.now();
      engine.current.update(
        inputs.current.vehicles,
        inputs.current.ages,
        now,
        true,
        live.current.shapeFor,
      );
      syncReact(now);
    };

    tick.current = (now) => {
      frame.current = null;
      if (document.hidden) return;
      // No visible glide below the zoom floor: stop the loop, show the truth.
      if (live.current.zoom < live.current.minZoom) {
        const at = performance.now();
        engine.current.update(
          inputs.current.vehicles,
          inputs.current.ages,
          at,
          true,
          live.current.shapeFor,
        );
        syncReact(at);
        return;
      }
      const moving = engine.current.isMoving(now);
      // Fractional tolerance avoids dropping alternate 60 Hz callbacks due
      // to tiny timestamp jitter; never allows 120 Hz uploads.
      if (!moving || now - lastPaint >= FRAME_MS - 0.5) {
        publish(now);
        lastPaint = nextLivePaint(now, lastPaint);
      }
      if (moving) frame.current = requestAnimationFrame(tick.current!);
    };

    const visibility = () => reset(); // Never replay a hidden tab's path.
    const preferenceChanged = () => {
      reducedMotion.current = preference.matches;
      reset();
    };
    document.addEventListener("visibilitychange", visibility);
    preference.addEventListener("change", preferenceChanged);
    return () => {
      cancel();
      tick.current = null;
      document.removeEventListener("visibilitychange", visibility);
      preference.removeEventListener("change", preferenceChanged);
    };
  }, []);

  const run = () => {
    if (
      !document.hidden &&
      live.current.zoom >= live.current.minZoom &&
      frame.current === null &&
      tick.current
    )
      frame.current = requestAnimationFrame(tick.current);
  };

  useEffect(() => {
    inputs.current = { vehicles, ages };
    const now = performance.now();
    engine.current.update(
      vehicles,
      ages,
      now,
      document.hidden ||
        reducedMotion.current ||
        live.current.zoom < live.current.minZoom,
      shapeFor,
    );
    // Snapshot clones arrive each second even when only positions changed.
    // React owns membership/appearance; imperative diffs own positions.
    const key = appearanceKey(vehicles, ages);
    const sampled = engine.current.sample(now);
    if (key !== shown.current) {
      shown.current = key;
      setDisplayed(sampled);
    }
    onFrame?.(sampled);
    if (engine.current.isMoving(now)) run();
  }, [vehicles, ages, shapeFor, onFrame]);

  // Only the zoom *floor crossing* matters. Depending on the live zoom value
  // itself would re-render on every wheel frame while zooming out.
  const aboveFloor = useRef(zoom >= minZoom);
  useEffect(() => {
    const next = zoom >= minZoom;
    if (next === aboveFloor.current) return;
    aboveFloor.current = next;
    const at = performance.now();
    if (!next) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      engine.current.update(
        inputs.current.vehicles,
        inputs.current.ages,
        at,
        true,
        shapeFor,
      );
      shown.current = appearanceKey(
        inputs.current.vehicles,
        inputs.current.ages,
      );
      const sampled = engine.current.sample(at);
      setDisplayed(sampled);
      onFrame?.(sampled);
      return;
    }
    if (engine.current.isMoving(at)) run();
  }, [zoom, minZoom, shapeFor, onFrame]);

  return displayed;
}
