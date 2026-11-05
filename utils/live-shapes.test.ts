import assert from "node:assert/strict";
import test from "node:test";
import { LiveShapeIndex, indexRouteShapes } from "./live-shapes";
import type { RouteDetail } from "./types/gtfs";
import type { LngLat } from "./live-path";

const line = (n: number): LngLat[] => [
  [106.8, -6.2 - n * 0.001],
  [106.801, -6.2 - n * 0.001],
];

const detail = (trips: [string, string][], shapes: string[]): RouteDetail =>
  ({
    route_id: "1",
    route_short_name: "1",
    route_long_name: "Test",
    route_color: "FF0000",
    stops: [],
    variants: trips.map(([trip_id, shape_id]) => ({
      trip_id,
      shape_id,
      direction_id: "0",
      kind: "utama",
      headsign: "",
      via: null,
      service_id: "",
      headwaySecs: null,
      windows: [],
      stopCount: 0,
      extraStops: [],
      skippedStops: [],
      stopIds: [],
    })),
    geometryByShape: Object.fromEntries(shapes.map((id, i) => [id, line(i)])),
  }) as unknown as RouteDetail;

test("a trip resolves to the shape it drives", () => {
  const shapes = indexRouteShapes(
    detail(
      [
        ["1-R07", "a"],
        ["1-R08", "b"],
      ],
      ["a", "b"],
    ),
  );
  const index = new LiveShapeIndex();
  index.set(
    "1",
    detail(
      [
        ["1-R07", "a"],
        ["1-R08", "b"],
      ],
      ["a", "b"],
    ),
  );
  assert.deepEqual(index.resolve("1", "1-R07"), shapes.shapes["a"]);
  assert.deepEqual(index.resolve("1", "1-R08"), shapes.shapes["b"]);
});

test("an unknown trip or route resolves to nothing instead of a guess", () => {
  const index = new LiveShapeIndex();
  index.set(
    "1",
    detail(
      [
        ["1-R07", "a"],
        ["1-R08", "b"],
      ],
      ["a", "b"],
    ),
  );
  assert.equal(index.resolve("1", "1-NOPE"), null);
  assert.equal(index.resolve("1", ""), null);
  assert.equal(index.resolve("99", "1-R07"), null);
  // A route with several shapes must not fall back to the first one.
  assert.equal(index.size, 1);
});

test("a route with a single shape can still resolve an unmatched trip", () => {
  const index = new LiveShapeIndex();
  index.set("7", detail([["7-R01", "only"]], ["only"]));
  assert.deepEqual(index.resolve("7", "7-other"), line(0));
  assert.deepEqual(index.resolve("7", ""), line(0));
});

test("route shapes are bounded and the least recently used is evicted", () => {
  const index = new LiveShapeIndex(2);
  index.set("a", detail([["a-1", "s"]], ["s"]));
  index.set("b", detail([["b-1", "s"]], ["s"]));
  assert.equal(index.size, 2);
  // Use "a" so "b" becomes the oldest.
  assert.ok(index.resolve("a", "a-1"));
  index.set("c", detail([["c-1", "s"]], ["s"]));
  assert.equal(index.size, 2);
  assert.ok(index.has("a"), "recently used route stays");
  assert.equal(index.has("b"), false, "least recently used route was evicted");
  assert.ok(index.has("c"));
  index.clear();
  assert.equal(index.size, 0);
});

test("degenerate shapes are ignored, never registered as one-point lines", () => {
  const broken = detail([["t", "one"]], ["one"]);
  broken.geometryByShape["one"] = [[106.8, -6.2]];
  const index = new LiveShapeIndex();
  index.set("x", broken);
  assert.equal(index.resolve("x", "t"), null);
});
