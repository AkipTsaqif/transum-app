import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLiveScope,
  liveScopeQuery,
  settledLiveBounds,
  vehicleInScope,
} from "./live-scope";
import type { LiveVehicle } from "./types/live";
test("viewport query rejects absent, unbounded, repeated, reversed and malformed scopes", () => {
  const known = new Set(["1"]);
  for (const q of [
    "",
    "bbox=",
    "bbox=1,,2,3",
    "bbox=NaN,-6,107,-5",
    "bbox=106,-5,107,-6",
    "bbox=-180,-90,180,90",
    "bbox=106,-7,107,-6&bbox=106,-7,107,-6",
    "route=1&bbox=106,-7,107,-6",
    "route=bogus",
  ])
    assert.equal(parseLiveScope(new URLSearchParams(q), known), null, q);
  const scope = parseLiveScope(
    new URLSearchParams("bbox=106.7,-6.3,106.9,-6.1"),
    known,
  )!;
  assert.deepEqual(scope, {
    routeId: null,
    bounds: [106.7, -6.3, 106.9, -6.1],
  });
  assert.equal(liveScopeQuery(scope), "bbox=106.7,-6.3,106.9,-6.1");
});
test("world-scale zoom keeps a bounded valid subscription instead of retrying an invalid bbox", () => {
  const bounds = settledLiveBounds([90, -20, 130, 10]);
  assert.ok(bounds[2] - bounds[0] <= 5);
  assert.ok(bounds[3] - bounds[1] <= 5);
  assert.ok(
    parseLiveScope(new URLSearchParams(`bbox=${bounds.join(",")}`), new Set()),
  );
});
test("a vehicle belongs to a corridor scope by route and to a viewport scope only inside its bounds", () => {
  const vehicle = (routeId: string, lat: number, lon: number) =>
    ({ routeId, latitude: lat, longitude: lon }) as LiveVehicle;
  const inside = vehicle("1", -6.2, 106.8);
  const outside = vehicle("1", -6.5, 106.8);

  assert.equal(vehicleInScope(inside, { routeId: "1", bounds: null }), true);
  assert.equal(vehicleInScope(inside, { routeId: "2", bounds: null }), false);
  assert.equal(
    vehicleInScope(inside, {
      routeId: null,
      bounds: [106.7, -6.3, 106.9, -6.1],
    }),
    true,
  );
  assert.equal(
    vehicleInScope(outside, {
      routeId: null,
      bounds: [106.7, -6.3, 106.9, -6.1],
    }),
    false,
  );
  // No scope is never an implicit whole-fleet query.
  assert.equal(vehicleInScope(inside, { routeId: null, bounds: null }), false);
});
test("route query encodes exact identifiers and an absent scope is not a fleet request", () => {
  assert.equal(
    liveScopeQuery({ routeId: "JAK.01", bounds: null }),
    "route=JAK.01",
  );
  assert.equal(liveScopeQuery({ routeId: null, bounds: null }), "");
});

test("a small pan inside the streamed area keeps the same request, so nothing reconnects", async () => {
  const { liveRequestBounds } = await import("./live-scope");
  const view: [number, number, number, number] = [106.8, -6.22, 106.84, -6.18];
  const first = liveRequestBounds(view, null);
  // Padded beyond the visible map on every side and snapped to the grid.
  assert.ok(first[0] < view[0] && first[1] < view[1]);
  assert.ok(first[2] > view[2] && first[3] > view[3]);
  for (const v of first)
    assert.ok(
      Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      `${v} not on grid`,
    );
  // Nudge the map by a fifth of its width: still the same request.
  const nudged = liveRequestBounds(
    [view[0] + 0.008, view[1] + 0.004, view[2] + 0.008, view[3] + 0.004],
    first,
  );
  assert.deepEqual(nudged, first);
  // A long pan leaves the area and asks for a new one around the new view.
  const far = liveRequestBounds(
    [view[0] + 0.2, view[1], view[2] + 0.2, view[3]],
    first,
  );
  assert.notDeepEqual(far, first);
  assert.ok(far[0] <= view[0] + 0.2 && far[2] >= view[2] + 0.2);
});

test("zooming in far enough tightens the request instead of streaming the whole old area", async () => {
  const { liveRequestBounds, LIVE_REQUEST_MAX_GROWTH } =
    await import("./live-scope");
  const wide = liveRequestBounds([106.6, -6.4, 107.0, -6.0], null);
  const close = liveRequestBounds([106.81, -6.21, 106.815, -6.205], wide);
  assert.notDeepEqual(close, wide);
  const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
  assert.ok(area(close) * LIVE_REQUEST_MAX_GROWTH < area(wide));
  // Zooming out past the area always asks for a bigger one.
  const out = liveRequestBounds([106.4, -6.6, 107.2, -5.8], wide);
  assert.ok(out[0] <= 106.4 && out[2] >= 107.2);
});

test("the request stays a valid bounded viewport scope at every zoom", async () => {
  const { liveRequestBounds } = await import("./live-scope");
  for (const view of [
    [106.82, -6.2, 106.83, -6.19],
    [106.5, -6.5, 107.1, -5.9],
    [90, -20, 130, 10],
  ] as [number, number, number, number][]) {
    const b = liveRequestBounds(view, null);
    assert.ok(
      parseLiveScope(new URLSearchParams(`bbox=${b.join(",")}`), new Set()),
      b.join(","),
    );
  }
});

test("buses carry over between viewport areas, never into or out of a route", async () => {
  const { carryOverVehicles } = await import("./live-scope");
  const bus = (id: string, routeId: string, lat: number, lon: number) =>
    ({ id, routeId, latitude: lat, longitude: lon }) as LiveVehicle;
  const vehicles = [bus("a", "1", -6.2, 106.8), bus("b", "2", -6.2, 107.1)];
  const oldArea = {
    routeId: null,
    bounds: [106.7, -6.3, 107.2, -6.1] as [number, number, number, number],
  };
  const newArea = {
    routeId: null,
    bounds: [106.75, -6.3, 106.95, -6.1] as [number, number, number, number],
  };
  assert.deepEqual(
    carryOverVehicles({ scope: oldArea, vehicles }, newArea).map((v) => v.id),
    ["a"],
  );
  assert.deepEqual(
    carryOverVehicles(
      { scope: oldArea, vehicles },
      { routeId: "1", bounds: null },
    ),
    [],
  );
  assert.deepEqual(
    carryOverVehicles(
      { scope: { routeId: "1", bounds: null }, vehicles },
      newArea,
    ),
    [],
  );
  assert.deepEqual(carryOverVehicles(null, newArea), []);
});
