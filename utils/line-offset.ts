import type { TransitMode } from "@/lib/gtfs";
import { AIRPORT_LINE_OFFSET_PX, airportLineOffset } from "./krl-line-offset";

/**
 * MapLibre `line-offset` is in screen pixels, to the right of the direction of
 * travel. Two kinds of overlap need it:
 *
 *  - KRL airport line: runs parallel to the Cikarang and Tangerang tracks.
 *  - LRT Jabodebek (mode "lrtj") Cibubur and Bekasi: one shared
 *    Dukuh Atas - Cawang trunk.
 *    Drawn on top of each other the later line hides the earlier, so each is
 *    pushed to its own side, 2 * offset apart.
 *
 * Offsets are display-only: baked geometry and station positions stay on the
 * physical track. The sign must flip with the direction of the coordinates so
 * both directions of a line land on the same physical side.
 */
export const LRT_TRUNK_OFFSET_PX = 3;

/** Which side of the shared trunk a line takes (+1 / -1). */
const LRT_SIDE: Record<string, 1 | -1> = { CB: 1, BK: -1 };

export function railLineOffset(
  mode: TransitMode,
  routeId: string,
  coordinates: [number, number][],
): number {
  if (coordinates.length < 2) return 0;
  if (mode === "krl") return airportLineOffset(routeId, coordinates);
  // Only LRT Jabodebek has a shared trunk; LRT Jakarta (mode "lrt") is a
  // single line and is never offset.
  if (mode === "lrtj") {
    const side = LRT_SIDE[routeId];
    if (!side) return 0;
    const heading =
      coordinates[0][0] > coordinates[coordinates.length - 1][0] ? 1 : -1;
    return heading * side * LRT_TRUNK_OFFSET_PX;
  }
  return 0;
}

export { AIRPORT_LINE_OFFSET_PX };
