import type { Feature, Point } from "geojson";
import type { GeoJSONFeatureDiff } from "maplibre-gl";

/** MapLibre's update array is NOT a Feature[]. Keep the public API typed. */
export function liveFeatureDiff(feature: Feature<Point>): GeoJSONFeatureDiff {
  if (feature.id === undefined)
    throw new Error("Live feature requires a stable id");
  return {
    id: feature.id,
    newGeometry: feature.geometry,
    addOrUpdateProperties: Object.entries(feature.properties ?? {}).map(
      ([key, value]) => ({ key, value }),
    ),
  };
}

/** No minimum pixel/metre step: preserve subpixel poses as they are sampled. */
export function livePoseKey(
  latitude: number,
  longitude: number,
  bearing: number | null,
): string {
  return `${latitude},${longitude},${bearing ?? "x"}`;
}

export const LIVE_FRAME_MS = 1000 / 60;

/** Keep fractional remainder, so 144Hz screens don't fall to 48fps by rounding
 * every interval up to three refreshes. Missed frames are never replayed. */
export function nextLivePaint(now: number, previous: number): number {
  if (!Number.isFinite(previous)) return now;
  return now - (((now - previous + 0.5) % LIVE_FRAME_MS) - 0.5);
}
