import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { StationIndexEntry } from "./types/gtfs";
import { getNearbyStations } from "@/lib/gtfs";
import { walkingConnections } from "./nearby";

const stations = JSON.parse(
  readFileSync("data/krl/stops.json", "utf8"),
) as StationIndexEntry[];
const sudirman = stations.find((s) => s.name === "Sudirman")!;

test("nearby stations span every dataset around Sudirman", async () => {
  const near = await getNearbyStations(sudirman.lat, sudirman.lon, 500);
  assert.ok(near.length > 10, `${near.length} candidates`);
  assert.ok(near.every((s) => s.distance <= 500));
  assert.ok(
    near.every((s, i) => i === 0 || near[i - 1].distance <= s.distance),
  );
  const byName = (n: string) => near.find((s) => s.name.startsWith(n));
  assert.equal(byName("St. Sudirman 2")?.mode, "gtfs");
  assert.equal(byName("Dukuh Atas BNI")?.mode, "mrt");
  assert.equal(byName("Dukuh Atas Bank Syariah")?.mode, "lrtj");
  // Same system as Sudirman, but the airport line is a different service.
  const bni = byName("BNI City");
  assert.equal(bni?.mode, "krl");
  assert.deepEqual(
    bni?.routes.map((r) => r.route_id),
    ["A", "C"],
  );
  // Raw candidates include the clicked station itself at distance 0; the
  // listing rule (utils/nearby.ts) is what drops it.
  assert.ok(
    near.some(
      (s) => s.name === "Sudirman" && s.mode === "krl" && s.distance === 0,
    ),
  );
});

test("the real Sudirman transfer list matches the owner's expectations", async () => {
  const near = await getNearbyStations(sudirman.lat, sudirman.lon, 500);
  const krl = near.find((s) => s.name === "Sudirman");
  const clicked = {
    mode: "krl" as const,
    name: "Sudirman",
    lat: sudirman.lat,
    lon: sudirman.lon,
    routes: krl?.routes ?? [],
  };
  const list = walkingConnections(
    clicked,
    near.filter((s) => !(s.mode === "krl" && s.name === "Sudirman")),
  );
  const names = list.map((c) => c.name);
  for (const expected of [
    "St. Sudirman 2",
    "Dukuh Atas BNI",
    "Galunggung",
    "Dukuh Atas Bank Syariah Indonesia",
    "BNI City",
  ]) {
    assert.ok(
      names.some((n) => n.startsWith(expected)),
      `${expected} missing from ${JSON.stringify(names)}`,
    );
  }
  // The owner's exact duplicate example: only the closest 1B stop is listed.
  assert.ok(names.some((n) => n.startsWith("Transport Hub Dukuh Atas")));
  assert.ok(
    !names.includes("Taman Kudus"),
    "Taman Kudus is farther on 1B than Transport Hub Dukuh Atas",
  );
  // BNI City is listed for the airport line only, not for Sudirman's own C.
  assert.deepEqual(
    list.find((c) => c.name === "BNI City")?.routes.map((r) => r.route_id),
    ["A"],
  );
});
