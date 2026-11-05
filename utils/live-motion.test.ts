import assert from "node:assert/strict";
import test from "node:test";
import { LiveMotion, LIVE_MOVE_MS, interpolateBearing } from "./live-motion";
import { LIVE_STALE_MS, type LiveVehicle } from "./types/live";

const bus = (extra: Partial<LiveVehicle> = {}): LiveVehicle => ({
  id: "bus-1",
  routeId: "1",
  routeShortName: "1",
  routeColor: "#FF0000",
  routeTextColor: "#FFFFFF",
  label: "Bus 1",
  headsign: "Kota",
  latitude: -6.2,
  longitude: 106.8,
  bearing: 359,
  currentStop: "A",
  nextStop: "B",
  receivedAt: 1_800_000_000_000,
  sourceTimestamp: 1_800_000_000_000,
  clockOffsetMs: 0,
  clock: "aligned",
  ...extra,
});
const later = (v: LiveVehicle, extra: Partial<LiveVehicle> = {}) => ({
  ...v,
  receivedAt: v.receivedAt + 2500,
  ...extra,
});
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("new buses appear immediately; existing ones move only towards the latest observation", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  assert.deepEqual(m.sample(0), [first]);
  assert.equal(m.isMoving(0), false);
  const next = later(first, { longitude: 106.801, bearing: 1 });
  m.update([next], {}, 100);
  near(m.sample(100)[0].longitude, first.longitude);
  near(m.sample(100 + LIVE_MOVE_MS / 2)[0].longitude, 106.8005);
  near(m.sample(100 + LIVE_MOVE_MS)[0].longitude, next.longitude);
  assert.equal(m.isMoving(100 + LIVE_MOVE_MS), false);
  // No extrapolation after the transition ends, even if the next packet never arrives.
  near(m.sample(100_000)[0].longitude, next.longitude);
  assert.equal(m.sample(100_000)[0].receivedAt, next.receivedAt);
});

test("heading follows the shortest turn around north", () => {
  near(interpolateBearing(359, 1, 0.5), 0);
  near(interpolateBearing(1, 359, 0.5), 0);
  near(interpolateBearing(90, 270, 1), 270);
  near(interpolateBearing(10, 350, 0.25), 5);
});

test("an update mid-transition starts from the displayed position without jumping backwards", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  const second = later(first, { longitude: 106.801, bearing: 1 });
  m.update([second], {}, 100);
  const at = 100 + LIVE_MOVE_MS / 2;
  const displayed = m.sample(at)[0];
  m.update([later(second, { longitude: 106.8015 })], {}, at);
  near(m.sample(at)[0].longitude, displayed.longitude);
  near(m.sample(at)[0].bearing, displayed.bearing);
  assert.ok(m.sample(at + 200)[0].longitude > displayed.longitude);
});

test("repeated snapshots and age ticks do not restart movement", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  const next = later(first, { longitude: 106.801 });
  m.update([next], {}, 100);
  m.update([{ ...next }], { [next.id]: 500 }, 500);
  near(m.sample(100 + LIVE_MOVE_MS)[0].longitude, next.longitude);
  assert.equal(m.isMoving(100 + LIVE_MOVE_MS), false);
});

test("large jumps, route changes, stale observations and long gaps snap", () => {
  const first = bus();
  for (const [next, ages] of [
    [later(first, { longitude: 106.85 }), {}],
    [later(first, { longitude: 106.801, routeId: "2" }), {}],
    [later(first, { longitude: 106.801 }), { [first.id]: LIVE_STALE_MS }],
    [
      later(first, {
        longitude: 106.801,
        receivedAt: first.receivedAt + 30_000,
      }),
      {},
    ],
  ] as [LiveVehicle, Record<string, number>][]) {
    const m = new LiveMotion();
    m.update([first], {}, 0);
    m.update([next], ages, 100);
    near(m.sample(100)[0].longitude, next.longitude);
    assert.equal(m.isMoving(100), false);
  }
});

test("tab resume/reduced motion resets to latest observations; removed vehicles never linger", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first, bus({ id: "other" })], {}, 0);
  const next = later(first, { longitude: 106.801 });
  m.update([next], {}, 100);
  assert.equal(m.sample(100).length, 1);
  m.update([next], {}, 200, true);
  near(m.sample(200)[0].longitude, next.longitude);
  assert.equal(m.isMoving(200), false);
  m.update([], {}, 300);
  assert.deepEqual(m.sample(300), []);
});
