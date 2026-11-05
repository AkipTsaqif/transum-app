"use client";
import { useEffect, useRef, useState } from "react";
import { LiveMotion } from "@/utils/live-motion";
import type { LiveVehicle } from "@/utils/types/live";

/** One bounded animation loop for all bus markers, local to the map layer.
 * Sidebar/detail data and receipt ages remain the actual observations. */
export function useLiveMotion(
  vehicles: LiveVehicle[],
  ages: Record<string, number>,
) {
  const engine = useRef(new LiveMotion());
  const inputs = useRef({ vehicles, ages });
  const [displayed, setDisplayed] = useState(vehicles);
  const frame = useRef<number | null>(null);
  const tick = useRef<((time: number) => void) | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = preference.matches;
    let lastPaint = -Infinity;
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    const reset = () => {
      cancel();
      const now = performance.now();
      engine.current.update(
        inputs.current.vehicles,
        inputs.current.ages,
        now,
        true,
      );
      setDisplayed(engine.current.sample(now));
    };
    tick.current = (now) => {
      frame.current = null;
      if (document.hidden) return;
      const moving = engine.current.isMoving(now);
      // Cap GeoJSON uploads to ~30 fps, rather than uploading 120+ times/sec
      // on high-refresh displays. Always paint the exact endpoint at the end.
      if (!moving || now - lastPaint >= 1000 / 30) {
        setDisplayed(engine.current.sample(now));
        lastPaint = now;
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

  useEffect(() => {
    inputs.current = { vehicles, ages };
    const now = performance.now();
    engine.current.update(
      vehicles,
      ages,
      now,
      document.hidden || reducedMotion.current,
    );
    setDisplayed(engine.current.sample(now));
    if (
      !document.hidden &&
      engine.current.isMoving(now) &&
      frame.current === null &&
      tick.current
    )
      frame.current = requestAnimationFrame(tick.current);
  }, [vehicles, ages]);

  return displayed;
}
