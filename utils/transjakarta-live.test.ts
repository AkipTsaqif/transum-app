import assert from "node:assert/strict";
import test from "node:test";
import { LiveVehicleStore, normalizeLiveVehicle } from "./transjakarta-live";
import { LIVE_TTL_MS } from "./types/live";
const now = 1_800_000_000_000;
const routes = new Map([
  ["1", "1"],
  ["JAK.01", "JAK.01"],
]);
const payload = (extra = {}) => ({
  bus_body_no: "TEST-1",
  route_code: "1",
  trip_id: "1-A",
  latitude: -6.2,
  longitude: 106.8,
  bearing: 90,
  timestamp: now,
  trip_headsign: "Terminal",
  ...extra,
});

test("live positions reject zero raw coordinates even with plausible snapped coordinates", () => {
  for (const extra of [
    { latitude: 0 },
    { longitude: 0 },
    { latitude: NaN },
    { longitude: Infinity },
    { latitude: -30 },
    { latitude: "-6.2" },
  ]) {
    assert.equal(
      normalizeLiveVehicle(
        payload({ snap_latitude: -6.2, snap_longitude: 106.8, ...extra }),
        routes,
        now,
      ),
      null,
    );
  }
});
test("validated snapped coordinates fall back to raw, and route codes join exactly", () => {
  const v = normalizeLiveVehicle(
    payload({ snap_latitude: -6.201, snap_longitude: 106.801 }),
    routes,
    now,
  )!;
  assert.equal(v.latitude, -6.201);
  assert.equal(
    normalizeLiveVehicle(
      payload({ snap_latitude: 0, snap_longitude: 0 }),
      routes,
      now,
    )?.latitude,
    -6.2,
  );
  assert.equal(
    normalizeLiveVehicle(
      payload({ snap_latitude: -6.9, snap_longitude: 107.1 }),
      routes,
      now,
    )?.latitude,
    -6.2,
  );
  assert.equal(
    normalizeLiveVehicle(payload({ route_code: "01" }), routes, now),
    null,
  );
  assert.equal(normalizeLiveVehicle(null, routes, now), null);
  assert.equal(
    normalizeLiveVehicle(payload({ bus_body_no: "" }), routes, now),
    null,
  );
});
test("seconds normalize to milliseconds, clock offset is not assumed to be seven hours", () => {
  const v = normalizeLiveVehicle(
    payload({ timestamp: (now - 3600_000) / 1000 }),
    routes,
    now,
  )!;
  assert.equal(v.sourceTimestamp, now - 3600_000);
  assert.equal(v.clock, "unverified");
  const aligned = normalizeLiveVehicle(payload(), routes, now)!;
  assert.equal(aligned.clock, "aligned");
});
test("advancing skewed device time establishes relative clock correction without marking every bus stale", () => {
  const store = new LiveVehicleStore(routes);
  store.ingest(payload({ timestamp: now - 3600_000 }), now);
  assert.equal(store.snapshot("1", now)[0].clock, "unverified");
  store.ingest(payload({ timestamp: now - 3600_000 + 5000 }), now + 5000);
  const v = store.snapshot("1", now + 5000)[0];
  assert.equal(v.clock, "adjusted");
  assert.equal(v.clockOffsetMs, 3600_000);
  assert.equal(v.receivedAt, now + 5000);
});
test("duplicates, old retained samples and out-of-order timestamps cannot refresh a frozen marker", () => {
  const store = new LiveVehicleStore(routes);
  store.ingest(payload(), now);
  store.ingest(payload(), now + 20_000);
  store.ingest(
    payload({ timestamp: now - 1000, latitude: -6.21 }),
    now + 30_000,
  );
  assert.equal(store.snapshot("1", now + 30_000)[0].receivedAt, now);
  assert.equal(store.snapshot("1", now + LIVE_TTL_MS).length, 0);
  store.ingest(payload({ timestamp: now - 3600_000 }), now + LIVE_TTL_MS, true);
  assert.equal(store.snapshot("1", now + LIVE_TTL_MS).length, 0);
});
test("vehicle replacement clears old route, TTL and memory remain bounded", () => {
  const store = new LiveVehicleStore(routes, 2);
  store.ingest(payload(), now);
  store.ingest(payload({ route_code: "JAK.01", timestamp: now + 1 }), now + 1);
  assert.equal(store.snapshot("1", now + 1).length, 0);
  assert.equal(store.snapshot("JAK.01", now + 1).length, 1);
  for (let i = 2; i < 6; i++)
    store.ingest(payload({ bus_body_no: `TEST-${i}` }), now + i);
  assert.equal(store.size, 2);
  store.clear();
  assert.equal(store.size, 0);
});

test("viewport returns multiple routes only inside bounds, route scope still isolates a corridor", () => {
  const store = new LiveVehicleStore(routes);
  store.ingest(payload(), now);
  store.ingest(payload({ bus_body_no: "TEST2", route_code: "JAK.01", latitude: -6.21 }), now);
  store.ingest(payload({ bus_body_no: "OUTSIDE", latitude: -6.5 }), now);
  const scope = { routeId: null, bounds: [106.7,-6.3,106.9,-6.1] as [number,number,number,number] };
  assert.equal(store.snapshot(scope, now).length, 2);
  assert.equal(store.snapshot("1", now).length, 2);
  assert.equal(store.snapshot({ routeId:null, bounds:null },now).length,0);
});
test("badge uses trusted GTFS route short name and contrasting route colour, not upstream colour", () => {
  const styles = new Map([["JAK.01", { shortName: "JAK.01", color: "FFE600" }]]);
  const v = normalizeLiveVehicle(payload({ route_code:"JAK.01", route_color:"FF0000" }), routes, now, styles)!;
  assert.equal(v.routeShortName,"JAK.01"); assert.equal(v.routeColor,"#FFE600"); assert.equal(v.routeTextColor,"#000000");
  assert.equal(normalizeLiveVehicle(payload(),routes,now)?.routeShortName,"1");
});
