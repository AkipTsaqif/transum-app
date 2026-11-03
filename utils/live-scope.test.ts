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
    vehicleInScope(inside, { routeId: null, bounds: [106.7, -6.3, 106.9, -6.1] }),
    true,
  );
  assert.equal(
    vehicleInScope(outside, { routeId: null, bounds: [106.7, -6.3, 106.9, -6.1] }),
    false,
  );
  // No scope is never an implicit whole-fleet query.
  assert.equal(vehicleInScope(inside, { routeId: null, bounds: null }), false);
});
test("route query encodes exact identifiers and an absent scope is not a fleet request", () => {
  assert.equal(liveScopeQuery({ routeId: "JAK.01", bounds: null }), "route=JAK.01");
  assert.equal(liveScopeQuery({ routeId: null, bounds: null }), "");
});
