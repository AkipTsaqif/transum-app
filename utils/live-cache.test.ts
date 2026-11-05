import assert from "node:assert/strict";
import test from "node:test";
import {
  elapsedSince,
  projectCachedVehicles,
  shouldReplaceCachedVehicles,
} from "./live-cache";
import { LIVE_STALE_MS, LIVE_TTL_MS, type LiveVehicle } from "./types/live";

const bus = (id: string) => ({ id }) as LiveVehicle;

test("switching tabs retains positions and advances their ages", () => {
  const vehicles = [bus("one"), bus("two")];
  const cached = projectCachedVehicles(
    vehicles,
    { one: 2000, two: 8000 },
    12_000,
  );
  assert.deepEqual(cached.vehicles, vehicles);
  assert.deepEqual(cached.ages, { one: 14000, two: 20000 });
  assert.ok(cached.ages.one < LIVE_STALE_MS);
});

test("cached positions fade on the existing 30 second threshold, then expire at 90", () => {
  const vehicles = [bus("fresh"), bus("older")];
  const ages = { fresh: 1000, older: 25_000 };
  const stale = projectCachedVehicles(vehicles, ages, 30_000);
  assert.equal(stale.vehicles.length, 2);
  assert.ok(stale.ages.fresh >= LIVE_STALE_MS);
  const expired = projectCachedVehicles(vehicles, ages, 65_000);
  assert.deepEqual(
    expired.vehicles.map((v) => v.id),
    ["fresh"],
  );
  assert.equal(expired.ages.fresh, 66_000);
  assert.ok(!("older" in expired.ages));
  assert.deepEqual(
    projectCachedVehicles(vehicles, ages, LIVE_TTL_MS).vehicles,
    [],
  );
});

test("wall-clock elapsed time accounts for sleep, without allowing a clock rollback to freshen buses", () => {
  assert.equal(
    elapsedSince(
      { wall: 1000, monotonic: 500 },
      { wall: 13_000, monotonic: 12_500 },
    ),
    12_000,
  );
  // Some browsers pause performance.now during sleep.
  assert.equal(
    elapsedSince(
      { wall: 1000, monotonic: 500 },
      { wall: 96_000, monotonic: 600 },
    ),
    95_000,
  );
  // A wall-clock rollback cannot make cached positions younger.
  assert.equal(
    elapsedSince(
      { wall: 5000, monotonic: 500 },
      { wall: 1000, monotonic: 5500 },
    ),
    5000,
  );
});

test("a connecting empty snapshot cannot clear cached buses, but an authoritative live empty snapshot can", () => {
  assert.equal(shouldReplaceCachedVehicles("connecting", 0), false);
  assert.equal(shouldReplaceCachedVehicles("reconnecting", 0), false);
  assert.equal(shouldReplaceCachedVehicles("disconnected", 0), false);
  assert.equal(shouldReplaceCachedVehicles("live", 0), true);
  assert.equal(shouldReplaceCachedVehicles("connecting", 1), true);
});
