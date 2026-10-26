import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import {
  TRANSIT_MODES,
  getOverview,
  getRouteDetail,
  getRouteIndex,
  getStopLayer,
  parseMode,
} from "../lib/gtfs";
import { CITY_MODES, cityForMode } from "./cities";

/**
 * Baked Surabaya data. Every assertion here is a fact from OpenStreetMap, not
 * a preference: OSM carries plenty of Surabaya rail geometry and almost no bus
 * routes, so the bus numbers are small and must stay visibly small.
 */

test("Surabaya is a city with its own datasets, not a Jakarta alias", () => {
  assert.deepEqual([...CITY_MODES.surabaya], [
    "sby-kai",
    "sby-suroboyo",
    "sby-transjatim",
  ]);
  for (const mode of CITY_MODES.surabaya) {
    assert.ok(TRANSIT_MODES.includes(mode));
    assert.equal(cityForMode(mode), "surabaya");
    assert.equal(parseMode(mode), mode);
  }
});

test("KAI Commuter Area VIII bakes the six published lines plus Sindro", async () => {
  const routes = await getRouteIndex("sby-kai");
  // Tumapel is excluded on purpose: it stopped running on 2025-01-31.
  assert.deepEqual(
    routes.map((r) => r.route_id).sort(),
    ["A", "B", "D", "J", "P", "SI", "SP"],
  );
  assert.ok(!routes.some((r) => r.route_id === "T"));
  // Display palette, not an official KAI colour: the record must say so.
  for (const r of routes) assert.match(r.route_color, /^[0-9A-F]{6}$/);

  const dhoho = await getRouteDetail("D", "sby-kai");
  assert.ok(dhoho);
  assert.equal(dhoho.stops[0].stop_name.length > 0, true);
  // Two directions baked per line.
  assert.equal(dhoho.variants.length, 2);
  // No timetable: OSM has no schedule, and we never synthesise one.
  for (const v of dhoho.variants) {
    assert.equal(v.headwaySecs, null);
    assert.deepEqual(v.windows, []);
  }
  const overview = (await getOverview("sby-kai")) as FeatureCollection;
  assert.equal(overview.features.length, routes.length * 2);
});

test("Suroboyo Bus bakes R1 with real stops and flags the rest as partial", async () => {
  const routes = await getRouteIndex("sby-suroboyo");
  assert.deepEqual(
    routes.map((r) => r.route_short_name).sort(),
    ["2", "3", "4", "5", "R1"],
  );
  const byShort = new Map(routes.map((r) => [r.route_short_name, r]));

  const r1 = byShort.get("R1")!;
  assert.equal(r1.stopsPartial, false);
  assert.equal(r1.openingHours, "06:00-22:00");

  const detail = await getRouteDetail(r1.route_id, "sby-suroboyo");
  assert.ok(detail);
  // 21 and 23 platform members across the two directions.
  assert.ok(detail.stops.length >= 38, `R1 has ${detail.stops.length} stops`);
  assert.equal(detail.openingHours, "06:00-22:00");

  // R2-R5 carry only 1-5 platform members against 50-92 way segments. The
  // geometry is real; the stop sequence is not, and must not be padded.
  for (const short of ["2", "3", "4", "5"]) {
    const route = byShort.get(short)!;
    assert.equal(route.stopsPartial, true, `${short} must be flagged partial`);
    const d = await getRouteDetail(route.route_id, "sby-suroboyo");
    assert.ok(d);
    assert.ok(
      d.stops.length <= 6,
      `${short} should expose only its mapped stops, got ${d.stops.length}`,
    );
  }
  assert.equal(
    ((await getStopLayer("sby-suroboyo")) as FeatureCollection).features
      .length,
    (await getRouteIndex("sby-suroboyo")).length > 0 ? 51 : 0,
  );
});

test("Trans Jatim is provincial and matched on operator, not network", async () => {
  const routes = await getRouteIndex("sby-transjatim");
  assert.deepEqual(
    routes.map((r) => r.route_id).sort(),
    ["K1", "K2", "K3"],
  );
  // These relations have no `network` tag at all, which is why a
  // network=Trans Jatim lookup returns zero.
  const k1 = await getRouteDetail("K1", "sby-transjatim");
  assert.ok(k1);
  assert.ok(k1.stops.length >= 10);
  assert.equal(k1.stops[0].sequence, 1);
});
