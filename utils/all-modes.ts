import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import type { TransitMode } from "@/lib/gtfs";
import {
  BUS_MODES,
  CITIES,
  REGIONAL_RAIL_ZOOM,
  CITY_MODES,
  cityForView,
  cityView,
  isBusMode,
  isCityView,
  type CityView,
} from "./cities";
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
export const ALL_MODE_ORDER: readonly TransitMode[] = CITIES.flatMap(
  (city) => CITY_MODES[city],
);

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
  const bus = parts.filter((p) => isBusMode(p.mode));
  const rail = parts.filter((p) => !isBusMode(p.mode));
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
  const features: Feature<Geometry>[] = [];
  for (const { mode, layer } of parts) {
    for (const feature of layer?.features ?? []) {
      const tagged: Feature<Geometry> = {
        ...feature,
        properties: { ...feature.properties, mode },
      };
      // Bus operators map the same terminal once each, a few metres apart
      // (Leuwipanjang, Dago, Cicaheum). They are one place on the ground, so
      // draw one dot and remember every dataset that stops there; the station
      // card lists each operator's lines. Rail stays as it is: Manggarai on
      // KRL and on LRT are genuinely two datasets and keep two symbols.
      if (isBusMode(mode)) {
        const twin = features.find(
          (candidate) =>
            isBusMode(candidate.properties?.mode as TransitMode) &&
            candidate.properties?.name === feature.properties?.name &&
            sameSpot(candidate, feature),
        );
        if (twin) {
          const modes = new Set<string>(
            (twin.properties?.modes as string[] | undefined) ?? [
              String(twin.properties?.mode),
            ],
          );
          modes.add(mode);
          twin.properties = { ...twin.properties, modes: [...modes] };
          continue;
        }
      }
      features.push(tagged);
    }
  }
  return { type: "FeatureCollection", features };
}

/** Two bus stop features closer than a platform length. */
const sameSpot = (a: Feature<Geometry>, b: Feature<Geometry>) => {
  if (a.geometry.type !== "Point" || b.geometry.type !== "Point") return false;
  const [alon, alat] = a.geometry.coordinates;
  const [blon, blat] = b.geometry.coordinates;
  return (
    Math.hypot(
      (alon - blon) * 111_320 * Math.cos(((alat + blat) * Math.PI) / 360),
      (alat - blat) * 110_540,
    ) <= 40
  );
};

/** What the mode picker can show: one dataset, or every dataset of a city. */
export type View = TransitMode | CityView;

export function parseView(value: string): View | null {
  if (isCityView(value)) return value;
  // `all` predates the city registry and meant "all of Jakarta"; keep it
  // working for saved state and links instead of silently selecting nothing.
  if (value === "all") return cityView("jakarta");
  return (ALL_MODE_ORDER as readonly string[]).includes(value)
    ? (value as TransitMode)
    : null;
}

/** The datasets a view draws from, read from the city registry. */
export const modesForView = (view: View): readonly TransitMode[] =>
  isCityView(view) ? CITY_MODES[cityForView(view)] : [view];

/**
 * Which dataset a request belongs to. A single-mode view always uses its own
 * mode. The all view has no mode of its own: a request about a route uses
 * that route's mode, and with nothing selected there is no single answer.
 */
export function dataModeFor(
  view: View,
  selectedKey: string | null,
): TransitMode | null {
  if (!isCityView(view)) return view;
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
  const isBus = ["in", ["get", "mode"], ["literal", [...BUS_MODES]]];
  return {
    "line-color": ["get", "color"],
    // Only the airport and the LRT trunk carry a signed screen-space offset.
    "line-offset": ["coalesce", ["get", "lineOffset"], 0],
    "line-opacity": allModes
      ? ["case", isBus, BUS_OPACITY, 1]
      : !isBusMode(mode)
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
      : !isBusMode(mode)
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
export const allStopsLabelFilter = (): unknown[] => {
  const regional = Object.entries(REGIONAL_RAIL_ZOOM) as [TransitMode, number][];
  return [
    "any",
    // Ordinary rail: z12, unless the mode is regional and has its own floor.
    [
      "all",
      ["!", ["in", ["get", "mode"], ["literal", [...BUS_MODES]]]],
      ...(regional.length
        ? [["!", ["in", ["get", "mode"], ["literal", regional.map(([m]) => m)]]]]
        : []),
      [">=", ["zoom"], 12],
    ],
    // A regional rail network fits far below z12, so its names come earlier.
    ...regional.map(([m, floor]) => [
      "all",
      ["==", ["get", "mode"], m],
      [">=", ["zoom"], floor],
    ]),
    [
      "all",
      ["in", ["get", "mode"], ["literal", [...BUS_MODES]]],
      [">=", ["zoom"], 14],
    ],
  ];
};

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
