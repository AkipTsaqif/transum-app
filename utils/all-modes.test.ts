import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { RouteSummary } from "./types/gtfs";
import type { TransitMode } from "@/lib/gtfs";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  ALL_MODE_ORDER,
  dataModeFor,
  groupRoutesByMode,
  mergeOverviews,
  allStopsLabelFilter,
  mergeStopLayers,
  overviewLinePaint,
  parseView,
  resolveStationMode,
  routeKey,
  splitRouteKey,
  type ModeRoute,
} from "./all-modes";

const route = (id: string): RouteSummary => ({
  route_id: id,
  route_short_name: id,
  route_long_name: `Route ${id}`,
  route_desc: "",
  route_color: "000000",
  route_text_color: "FFFFFF",
});
const line = (color: string, extra = {}) => ({
  type: "Feature" as const,
  properties: { color, ...extra },
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [106.8, -6.2],
      [106.81, -6.21],
    ] as [number, number][],
  },
});
const point = (name: string) => ({
  type: "Feature" as const,
  properties: { name },
  geometry: {
    type: "Point" as const,
    coordinates: [106.8, -6.2] as [number, number],
  },
});

test("route keys carry the mode so equal ids from two datasets never clash", () => {
  assert.equal(routeKey("krl", "A"), "krl:A");
  assert.notEqual(routeKey("krl", "A"), routeKey("gtfs", "A"));
  assert.deepEqual(splitRouteKey("lrtj:CB"), { mode: "lrtj", routeId: "CB" });
  // A route id that itself contains a colon must survive the round trip.
  assert.deepEqual(splitRouteKey(routeKey("gtfs", "9:A")), {
    mode: "gtfs",
    routeId: "9:A",
  });
  assert.equal(splitRouteKey("nonsense"), null);
  assert.equal(splitRouteKey("bus:1"), null, "unknown mode prefix is rejected");
});

test("all-modes view lists rail before bus, each mode once", () => {
  assert.deepEqual(ALL_MODE_ORDER, ["krl", "mrt", "lrt", "lrtj", "gtfs"]);
});

test("routes are grouped per mode in display order, keeping each mode's own order", () => {
  const groups = groupRoutesByMode([
    { mode: "gtfs", route: route("1") },
    { mode: "krl", route: route("C") },
    { mode: "gtfs", route: route("2") },
    { mode: "lrtj", route: route("CB") },
    { mode: "krl", route: route("A") },
  ] satisfies ModeRoute[]);
  assert.deepEqual(
    groups.map((g) => [g.mode, g.routes.map((r) => r.route.route_id)]),
    [
      ["krl", ["C", "A"]],
      ["lrtj", ["CB"]],
      ["gtfs", ["1", "2"]],
    ],
  );
  // Empty modes are omitted rather than rendering a lone heading.
  assert.ok(!groups.some((g) => g.mode === "mrt"));
  assert.deepEqual(groupRoutesByMode([]), []);
});

test("merged overview keeps every line, tags its mode, and draws bus under rail", () => {
  const merged = mergeOverviews([
    {
      mode: "krl",
      overview: { type: "FeatureCollection", features: [line("#26BAED")] },
    },
    {
      mode: "gtfs",
      overview: {
        type: "FeatureCollection",
        features: [line("#FFB6DB"), line("#000000")],
      },
    },
    {
      mode: "lrtj",
      overview: {
        type: "FeatureCollection",
        features: [line("#20409A", { lineOffset: 3 })],
      },
    },
  ]);
  assert.equal(merged.features.length, 4);
  // Bus first: MapLibre paints later features on top within one layer.
  assert.deepEqual(
    merged.features.map((f) => f.properties?.mode),
    ["gtfs", "gtfs", "krl", "lrtj"],
  );
  // Per-line properties survive (the LRT trunk offset must not be lost).
  assert.equal(merged.features.at(-1)!.properties?.lineOffset, 3);
  assert.equal(merged.features.at(-1)!.properties?.color, "#20409A");
});

test("merged stop layer tags each station with its mode and tolerates a missing mode", () => {
  const krl: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [point("Manggarai")],
  };
  const mrt: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: [point("Blok M BCA"), point("Dukuh Atas BNI")],
  };
  const merged = mergeStopLayers([
    { mode: "krl", layer: krl },
    { mode: "mrt", layer: mrt },
    { mode: "gtfs", layer: null },
  ]);
  assert.equal(merged.features.length, 3);
  assert.deepEqual(
    merged.features.map((f) => f.properties?.mode),
    ["krl", "mrt", "mrt"],
  );
  // Same-name stations in different modes stay distinct (different systems).
  assert.deepEqual(
    merged.features.map((f) => f.properties?.name),
    ["Manggarai", "Blok M BCA", "Dukuh Atas BNI"],
  );
  // Inputs are not mutated.
  assert.equal(krl.features[0].properties?.mode, undefined);
});

test("merging empty inputs is safe", () => {
  assert.deepEqual(mergeOverviews([]).features, []);
  assert.deepEqual(mergeStopLayers([]).features, []);
  const lines: FeatureCollection<LineString> = mergeOverviews([
    { mode: "mrt", overview: null },
  ]);
  assert.deepEqual(lines.features, []);
});

test("the effective data mode follows the owning route in the all view", () => {
  // Single-mode views: everything belongs to that mode.
  assert.equal(dataModeFor("krl", null), "krl");
  assert.equal(dataModeFor("mrt", "mrt:M"), "mrt");
  // All view: the selected route decides; nothing selected -> no single mode.
  assert.equal(dataModeFor("all", "lrtj:CB"), "lrtj");
  assert.equal(dataModeFor("all", "gtfs:1"), "gtfs");
  assert.equal(dataModeFor("all", null), null);
  assert.equal(dataModeFor("all", "garbage"), null);
});

test("view parsing accepts every dataset mode plus all, and nothing else", () => {
  for (const v of ["gtfs", "krl", "mrt", "lrt", "lrtj", "all"]) {
    assert.equal(parseView(v), v);
  }
  assert.equal(parseView("bus"), null);
  assert.equal(parseView(""), null);
});

test("overview paint is valid MapLibre style and keeps zoom at the top level", () => {
  // MapLibre rejects a zoom expression nested inside `case`; this catches that
  // class of bug without a browser.
  for (const allModes of [true, false]) {
    for (const mode of ["gtfs", "krl"] as TransitMode[]) {
      const paint = overviewLinePaint(allModes, mode);
      const style = {
        version: 8 as const,
        sources: {
          overview: {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
          },
        },
        layers: [
          {
            id: "overview-line",
            type: "line" as const,
            source: "overview",
            paint,
          },
        ],
      };
      const errors = validateStyleMin(style as never);
      assert.deepEqual(
        errors.map((e) => e.message),
        [],
        `allModes=${allModes} mode=${mode}`,
      );
    }
  }
  // In the all view the split is per feature, not global.
  const paint = overviewLinePaint(true, "krl");
  assert.ok(JSON.stringify(paint["line-width"]).includes('"get","mode"'));
  // Single mode stays global, so the bus network is faint and rail is bold.
  assert.equal(overviewLinePaint(false, "gtfs")["line-opacity"], 0.35);
  assert.equal(overviewLinePaint(false, "krl")["line-opacity"], 1);
});

test("all-mode station names start at z12, bus stop names later", () => {
  const filter = allStopsLabelFilter();
  const style = {
    version: 8 as const,
    sources: { stops: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } },
    layers: [{ id: "all-stops-label", type: "symbol" as const, source: "stops", filter }],
  };
  assert.deepEqual(validateStyleMin(style as never).map((e) => e.message), []);
  // Rail station names are readable from z12; the 6,437 bus names wait for z14.
  assert.deepEqual(filter, [
    "any",
    ["all", ["!=", ["get", "mode"], "gtfs"], [">=", ["zoom"], 12]],
    ["all", ["==", ["get", "mode"], "gtfs"], [">=", ["zoom"], 14]],
  ]);
});

test("a clicked station resolves to the dataset it lives in", () => {
  const at = (name: string, lat: number, lon: number) => ({
    type: "Feature" as const,
    properties: { name },
    geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
  });
  const layers = [
    { mode: "krl" as TransitMode, layer: { type: "FeatureCollection" as const, features: [at("Manggarai", -6.21017, 106.84993)] } },
    // Same name, different system ~1.2 km away (LRT Jakarta's own Manggarai).
    { mode: "gtfs" as TransitMode, layer: { type: "FeatureCollection" as const, features: [at("Manggarai", -6.221, 106.85), at("Bundaran HI", -6.19, 106.82)] } },
  ];
  const near = { name: "Manggarai", lat: -6.21017, lon: 106.84993 };
  // Explicit mode from the map dot / search hit always wins.
  assert.equal(resolveStationMode("gtfs", "krl", layers, near), "gtfs");
  // A single-mode view never needs the search: its own dataset owns the click.
  assert.equal(resolveStationMode(undefined, "lrtj", layers, near), "lrtj");
  // The all view has no fallback, so the nearest same-name station decides.
  assert.equal(resolveStationMode(undefined, null, layers, near), "krl");
  assert.equal(resolveStationMode(undefined, null, layers, { name: "Bundaran HI", lat: -6.19, lon: 106.82 }), "gtfs");
  // Nothing matching nearby -> no owner, rather than guessing a dataset.
  assert.equal(resolveStationMode(undefined, null, layers, { name: "Nowhere", lat: -6.21, lon: 106.85 }), null);
  assert.equal(resolveStationMode(undefined, null, layers, { name: "Bundaran HI", lat: -6.30, lon: 106.82 }), null);
  assert.equal(resolveStationMode(undefined, null, [], near), null);
});
