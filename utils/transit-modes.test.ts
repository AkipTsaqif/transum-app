import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import {
  TRANSIT_MODES,
  parseMode,
  getRouteIndex,
  getRouteDetail,
  getStopLayer,
  getOverview,
  searchStations,
  resolveStation,
} from "../lib/gtfs";

test("MRT mode reads its own stations and routes without leaking KRL or bus data", async () => {
  assert.ok(TRANSIT_MODES.includes("mrt"));
  assert.equal(parseMode("mrt"), "mrt");
  assert.equal(parseMode("invalid"), "gtfs");
  assert.equal(parseMode(null), "gtfs");
  const routes = await getRouteIndex("mrt");
  assert.deepEqual(
    routes.map((r) => r.route_id),
    ["M"],
  );
  const route = await getRouteDetail("M", "mrt");
  assert.equal(route?.stops.length, 13);
  assert.equal(await getRouteDetail("A", "mrt"), null);
  assert.equal(
    ((await getStopLayer("mrt")) as FeatureCollection).features.length,
    13,
  );
  assert.equal((await getOverview("mrt")).features.length, 2);
  const hits = await searchStations("Dukuh Atas", 20, "mrt");
  assert.equal(hits.length, 1);
  const stop = route!.stops.find((s) => s.stop_name.startsWith("Dukuh Atas"))!;
  const station = await resolveStation(
    stop.stop_name,
    stop.stop_lat,
    stop.stop_lon,
    "mrt",
  );
  assert.equal(station?.routes.length, 1);
  assert.equal(station?.routes[0].route_id, "M");
  assert.equal(
    await resolveStation("Bogor", stop.stop_lat, stop.stop_lon, "mrt"),
    null,
  );
  assert.ok((await getRouteIndex("krl")).some((r) => r.route_id === "A"));
});
