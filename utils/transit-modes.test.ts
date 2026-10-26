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
  // An unknown mode used to resolve to "gtfs", which served Transjakarta data
  // under a URL that named a different mode. It is now a missing dataset.
  assert.equal(parseMode("invalid"), null);
  assert.equal(parseMode(null), null);
  assert.equal(parseMode("sby-medan"), null);
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

test("LRT Jakarta is its own mode: line J only, no Jabodebek data", async () => {
  assert.ok(TRANSIT_MODES.includes("lrt"));
  assert.equal(parseMode("lrt"), "lrt");
  assert.deepEqual(
    (await getRouteIndex("lrt")).map((r) => r.route_id),
    ["J"],
  );
  assert.equal((await getRouteDetail("J", "lrt"))?.stops.length, 11);
  assert.equal(await getRouteDetail("CB", "lrt"), null);
  assert.equal(await getRouteDetail("BK", "lrt"), null);
  assert.equal(await getRouteDetail("M", "lrt"), null);
  assert.equal(
    ((await getStopLayer("lrt")) as FeatureCollection).features.length,
    11,
  );
  assert.equal((await getOverview("lrt")).features.length, 2);
  assert.equal((await searchStations("Velodrome", 20, "lrt")).length, 1);
  assert.equal((await searchStations("Cawang", 20, "lrt")).length, 0);
});

test("LRT Jabodebek is its own mode: Cibubur and Bekasi with merged trunk stations", async () => {
  assert.ok(TRANSIT_MODES.includes("lrtj"));
  assert.equal(parseMode("lrtj"), "lrtj");
  assert.deepEqual(
    (await getRouteIndex("lrtj")).map((r) => r.route_id),
    ["CB", "BK"],
  );
  assert.equal((await getRouteDetail("CB", "lrtj"))?.stops.length, 12);
  assert.equal((await getRouteDetail("BK", "lrtj"))?.stops.length, 14);
  assert.equal(await getRouteDetail("J", "lrtj"), null);
  assert.equal(
    ((await getStopLayer("lrtj")) as FeatureCollection).features.length,
    18,
  );
  assert.equal((await getOverview("lrtj")).features.length, 4);

  // A shared trunk station resolves to ONE station served by both lines.
  const cb = (await getRouteDetail("CB", "lrtj"))!;
  const cawang = cb.stops.find((s) => s.stop_name === "Cawang")!;
  const station = await resolveStation(
    "Cawang",
    cawang.stop_lat,
    cawang.stop_lon,
    "lrtj",
  );
  assert.deepEqual(station?.routes.map((r) => r.route_id).sort(), ["BK", "CB"]);
  assert.equal((await searchStations("Cawang", 20, "lrtj")).length, 1);
  assert.equal((await searchStations("Velodrome", 20, "lrtj")).length, 0);
});

test("route ids and stations never leak between the rail modes", async () => {
  assert.equal(await getRouteDetail("CB", "krl"), null);
  assert.equal(await getRouteDetail("CB", "mrt"), null);
  assert.equal((await searchStations("Cawang", 20, "mrt")).length, 0);
  assert.equal((await searchStations("Velodrome", 20, "krl")).length, 0);
  assert.deepEqual(
    (await getRouteIndex("mrt")).map((r) => r.route_id),
    ["M"],
  );
  assert.ok((await getRouteIndex("krl")).some((r) => r.route_id === "A"));
});
