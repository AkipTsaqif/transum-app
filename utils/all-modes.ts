import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import type { TransitMode } from "@/lib/gtfs";
import type { RouteSummary } from "./types/gtfs";

/**
 * The "all modes" view. It is a client-side composition of the per-mode
 * datasets, not a dataset of its own: every route and station still belongs to
 * exactly one mode and is fetched from that mode's API.
 *
 * Route ids are only unique WITHIN a mode, so anything that identifies a route
 * across modes uses a mode-qualified key (`krl:A`, `gtfs:9:A`).
 */

/** Display order: rail first (few, important lines), bus last (240 routes). */
export const ALL_MODE_ORDER: readonly TransitMode[] = [
  "krl",
  "mrt",
  "lrt",
  "lrtj",
  "gtfs",
];

export interface ModeRoute {
  mode: TransitMode;
  route: RouteSummary;
}

export const routeKey = (mode: TransitMode, routeId: string) =>
  `${mode}:${routeId}`;

/** Inverse of routeKey. Splits on the FIRST colon: GTFS ids may contain one. */
export function splitRouteKey(
  key: string,
): { mode: TransitMode; routeId: string } | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const mode = key.slice(0, at);
  if (!(ALL_MODE_ORDER as readonly string[]).includes(mode)) return null;
  return { mode: mode as TransitMode, routeId: key.slice(at + 1) };
}

export interface RouteGroup {
  mode: TransitMode;
  routes: ModeRoute[];
}

/** Group by mode in ALL_MODE_ORDER, preserving each mode's own route order. */
export function groupRoutesByMode(routes: ModeRoute[]): RouteGroup[] {
  return ALL_MODE_ORDER.map((mode) => ({
    mode,
    routes: routes.filter((r) => r.mode === mode),
  })).filter((group) => group.routes.length > 0);
}

/**
 * One overview for the map. Bus lines come first so the rail lines, drawn
 * later in the same source, paint on top of them. Every feature is tagged
 * with its mode so the map can style bus faint and rail bold, and per-line
 * properties (colour, the LRT trunk offset) pass through untouched.
 */
export function mergeOverviews(
  parts: {
    mode: TransitMode;
    overview: FeatureCollection<LineString> | null;
  }[],
): FeatureCollection<LineString> {
  const bus = parts.filter((p) => p.mode === "gtfs");
  const rail = parts.filter((p) => p.mode !== "gtfs");
  const features: Feature<LineString>[] = [...bus, ...rail].flatMap(
    ({ mode, overview }) =>
      (overview?.features ?? []).map((feature) => ({
        ...feature,
        properties: { ...feature.properties, mode },
      })),
  );
  return { type: "FeatureCollection", features };
}

/**
 * One station layer for the map. Same-name stations in two modes (Manggarai
 * on KRL and on LRT Jakarta) are different systems and stay distinct; each is
 * tagged with its mode so a click resolves against the right dataset.
 */
export function mergeStopLayers(
  parts: { mode: TransitMode; layer: FeatureCollection | null }[],
): FeatureCollection {
  const features: Feature<Geometry>[] = parts.flatMap(({ mode, layer }) =>
    (layer?.features ?? []).map((feature) => ({
      ...feature,
      properties: { ...feature.properties, mode },
    })),
  );
  return { type: "FeatureCollection", features };
}

/** What the mode picker can show: one dataset, or every dataset together. */
export type View = TransitMode | "all";

export function parseView(value: string): View | null {
  if (value === "all") return "all";
  return (ALL_MODE_ORDER as readonly string[]).includes(value)
    ? (value as TransitMode)
    : null;
}

/**
 * Which dataset a request belongs to. A single-mode view always uses its own
 * mode. The all view has no mode of its own: a request about a route uses
 * that route's mode, and with nothing selected there is no single answer.
 */
export function dataModeFor(
  view: View,
  selectedKey: string | null,
): TransitMode | null {
  if (view !== "all") return view;
  return selectedKey ? (splitRouteKey(selectedKey)?.mode ?? null) : null;
}

/** Bus routes stay faint and thin; rail lines draw bold on top. */
const BUS_OPACITY = 0.35;
const BUS_WIDTH = [
  "interpolate" as const,
  ["linear" as const],
  ["zoom" as const],
  9,
  1,
  13,
  2.5,
];
const RAIL_WIDTH = 3;

/**
 * Paint for the faint network.
 *
 * MapLibre allows a zoom expression only at the top level of a `step` or
 * `interpolate`, so the all-view split cannot nest the bus width ramp inside a
 * `case`. The zoom `interpolate` stays on top and the per-mode choice becomes
 * its output value instead.
 */
export function overviewLinePaint(
  allModes: boolean,
  mode: TransitMode,
): Record<string, unknown> {
  const isBus = ["==", ["get", "mode"], "gtfs"];
  return {
    "line-color": ["get", "color"],
    // Only the airport and the LRT trunk carry a signed screen-space offset.
    "line-offset": ["coalesce", ["get", "lineOffset"], 0],
    "line-opacity": allModes
      ? ["case", isBus, BUS_OPACITY, 1]
      : mode !== "gtfs"
        ? 1
        : BUS_OPACITY,
    "line-width": allModes
      ? [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          ["case", isBus, 1, RAIL_WIDTH],
          13,
          ["case", isBus, 2.5, RAIL_WIDTH],
        ]
      : mode !== "gtfs"
        ? RAIL_WIDTH
        : BUS_WIDTH,
  };
}

/**
 * Which station names the all view shows, by zoom.
 *
 * Rail names are readable from z12, where the city-wide view still reads as a
 * network rather than a wall of text. The 6,437 bus stop names stay at z14:
 * at z12 they would be an unreadable smear, which is why the bus-only view
 * gates them there too.
 *
 * `["zoom"]` inside a filter is evaluated at integer zoom levels, which is the
 * same granularity as a `minzoom`, so this behaves like a per-feature floor.
 */
export const allStopsLabelFilter = (): unknown[] => [
  "any",
  ["all", ["!=", ["get", "mode"], "gtfs"], [">=", ["zoom"], 12]],
  ["all", ["==", ["get", "mode"], "gtfs"], [">=", ["zoom"], 14]],
];

export interface StationPoint {
  name: string;
  lat: number;
  lon: number;
}

const metresApart = (a: StationPoint, b: StationPoint) =>
  Math.hypot(
    (a.lon - b.lon) * 111_320 * Math.cos(((a.lat + b.lat) * Math.PI) / 360),
    (a.lat - b.lat) * 110_540,
  );

/**
 * Which dataset a clicked station belongs to.
 *
 * A map dot or search hit in the all view already knows (`explicit`), and a
 * single-mode view always owns its own clicks (`fallback`). The all view has
 * neither for an interchange pip, so the loaded station layers are searched
 * for the nearest same-named station. Without this the click resolves to no
 * dataset and is silently dropped.
 *
 * `maxMetres` keeps a same-named station in another part of the city from
 * being picked; two systems can share a name (Manggarai on KRL and on LRT
 * Jakarta), so proximity, not the name alone, decides.
 */
export function resolveStationMode(
  explicit: TransitMode | null | undefined,
  fallback: TransitMode | null,
  layers: { mode: TransitMode; layer: FeatureCollection | null }[],
  station: StationPoint,
  maxMetres = 150,
): TransitMode | null {
  if (explicit) return explicit;
  if (fallback) return fallback;

  let best: { mode: TransitMode; distance: number } | null = null;
  for (const { mode, layer } of layers) {
    for (const feature of layer?.features ?? []) {
      if (feature.properties?.name !== station.name) continue;
      const [lon, lat] = (feature.geometry as { coordinates: number[] })
        .coordinates;
      const distance = metresApart(station, { ...station, lat, lon });
      if (distance <= maxMetres && (!best || distance < best.distance)) {
        best = { mode, distance };
      }
    }
  }
  return best?.mode ?? null;
}
