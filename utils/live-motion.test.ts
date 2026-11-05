import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveMotion,
  LIVE_MOVE_MIN_MS,
  LIVE_MOVE_MAX_MS,
  LIVE_MOVE_SNAP_MS,
  glideDuration,
  interpolateBearing,
} from "./live-motion";
import { LIVE_STALE_MS, type LiveVehicle } from "./types/live";

const bus = (extra: Partial<LiveVehicle> = {}): LiveVehicle => ({
  id: "bus-1",
  routeId: "1",
  routeShortName: "1",
  routeColor: "#FF0000",
  routeTextColor: "#FFFFFF",
  tripId: "1-R07",
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
/** `later()` advances receivedAt by 2.5 s, so that is the glide for those fixtures. */
const GLIDE = 2_500;
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("glide duration follows the bus's own fix interval, clamped to 1-6 s", () => {
  // The 900 ms default left a bus still for ~1.6 s between fixes (median
  // interval 2.5 s). Duration is now the measured interval so the marker is
  // still gliding when the next fix lands.
  const cases: [number, number][] = [
    [2_500, 2_500], // typical
    [500, LIVE_MOVE_MIN_MS], // very chatty bus -> floor
    [9_000, LIVE_MOVE_MAX_MS], // slow bus -> ceiling, not a 9 s crawl
  ];
  for (const [interval, expected] of cases) {
    const m = new LiveMotion();
    const first = bus();
    m.update([first], {}, 0);
    const next = {
      ...first,
      longitude: 106.8005,
      receivedAt: first.receivedAt + interval,
    };
    m.update([next], {}, 100);
    assert.equal(m.durationOf(first.id), expected, `interval ${interval}`);
    assert.equal(m.isMoving(100 + expected - 1), true);
    assert.equal(m.isMoving(100 + expected), false);
  }
});
test("the first fix of a bus never animates, and a 15 s gap still snaps", () => {
  const m = new LiveMotion();
  m.update([bus()], {}, 0);
  assert.equal(m.durationOf("bus-1"), LIVE_MOVE_SNAP_MS);
  const first = bus();
  m.update(
    [{ ...first, longitude: 106.8005, receivedAt: first.receivedAt + 16_000 }],
    {},
    100,
  );
  assert.equal(m.isMoving(100), false);
});
test("new buses appear immediately; existing ones move only towards the latest observation", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  assert.deepEqual(m.sample(0), [first]);
  assert.equal(m.isMoving(0), false);
  const next = later(first, { longitude: 106.801, bearing: 1 });
  m.update([next], {}, 100);
  near(m.sample(100)[0].longitude, first.longitude);
  near(m.sample(100 + GLIDE / 2)[0].longitude, 106.8005);
  near(m.sample(100 + GLIDE)[0].longitude, next.longitude);
  assert.equal(m.isMoving(100 + GLIDE), false);
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

test("a stopped bus keeps its last confident heading instead of spinning at a halte", () => {
  const m = new LiveMotion();
  const first = bus({ bearing: 90 });
  m.update([first], {}, 0);
  // Parked: the device still reports wobbling bearings while displacement is
  // under 5 m. Hold 90 rather than following the jitter.
  let at = 0;
  for (const wobble of [92, 88, 91, 89, 87]) {
    at += 2_500;
    const before = at;
    const next = {
      ...first,
      // ~1 m north-south drift, well under the hold threshold.
      latitude: first.latitude + 0.000009 * (wobble - 90),
      longitude: first.longitude,
      bearing: wobble,
      receivedAt: first.receivedAt + at,
    };
    m.update([next], {}, before);
    assert.equal(m.sample(before)[0].bearing, 90, `held at ${wobble}`);
  }
  // Actually moving: the new heading is taken.
  at += 2_500;
  m.update(
    [
      {
        ...first,
        latitude: first.latitude - 0.0005,
        bearing: 180,
        receivedAt: first.receivedAt + at,
      },
    ],
    {},
    at,
  );
  assert.equal(m.sample(at + GLIDE)[0].bearing, 180);
});
test("a bus with no heading stays unknown; it is never invented as north", () => {
  const m = new LiveMotion();
  const first = bus({ bearing: null });
  m.update([first], {}, 0);
  assert.equal(m.sample(0)[0].bearing, null);
  const next = {
    ...first,
    longitude: 106.8005,
    receivedAt: first.receivedAt + 2_500,
  };
  m.update([next], {}, 100);
  assert.equal(m.sample(100)[0].bearing, null);
  assert.equal(m.sample(100 + GLIDE)[0].bearing, null);
  // Heading appearing later is picked up once the bus moves.
  const moved = {
    ...first,
    latitude: first.latitude - 0.0005,
    bearing: 45,
    receivedAt: first.receivedAt + 5_000,
  };
  m.update([moved], {}, 200 + GLIDE);
  assert.equal(m.sample(200 + GLIDE)[0].bearing, 45);
});
test("a supplied shape makes the glide follow the road and turn with it", () => {
  // An L-shaped road: north, then east. A straight glide would cut the corner.
  const road: [number, number][] = [
    [106.8, -6.2],
    [106.8, -6.199],
    [106.801, -6.199],
  ];
  const m = new LiveMotion();
  const start = bus({ latitude: -6.2, longitude: 106.8, bearing: 0 });
  m.update([start], {}, 0);
  const end = {
    ...start,
    latitude: -6.199,
    longitude: 106.801,
    bearing: 90,
    receivedAt: start.receivedAt + 2_500,
  };
  m.update([end], {}, 100, false, () => road);

  // Halfway along the road is the corner, not the chord's midpoint.
  const middle = m.sample(100 + GLIDE / 2)[0];
  const chord: [number, number] = [106.8005, -6.1995];
  const gap = Math.hypot(
    (middle.longitude - chord[0]) *
      111_320 *
      Math.cos((middle.latitude * Math.PI) / 180),
    (middle.latitude - chord[1]) * 110_540,
  );
  assert.ok(
    gap > 60,
    `middle should sit on the corner, ${gap} m from the chord`,
  );
  // Heading turns with the road (north/0 early, east/90 late).
  assert.ok((m.sample(110)[0].bearing ?? -1) < 30);
  assert.ok((m.sample(100 + GLIDE - 10)[0].bearing ?? -1) > 60);
  // Still ends exactly on the observation.
  near(m.sample(100 + GLIDE)[0].longitude, end.longitude);
});
test("no shape, or a shape that does not explain the move, keeps the straight glide", () => {
  const straight = (shapeFor?: () => [number, number][]) => {
    const m = new LiveMotion();
    const start = bus();
    m.update([start], {}, 0);
    const end = {
      ...start,
      longitude: 106.801,
      receivedAt: start.receivedAt + 2_500,
    };
    m.update([end], {}, 100, false, shapeFor);
    return m.sample(100 + GLIDE / 2)[0].longitude;
  };
  // No resolver at all, and a road 1 km away: both interpolate the chord.
  near(straight(), 106.8005);
  near(
    straight(() => [
      [106.9, -6.2],
      [106.9, -6.19],
    ]),
    106.8005,
  );
});
test("an update mid-transition starts from the displayed position without jumping backwards", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  const second = later(first, { longitude: 106.801, bearing: 1 });
  m.update([second], {}, 100);
  const at = 100 + GLIDE / 2;
  const displayed = m.sample(at)[0];
  m.update([later(second, { longitude: 106.8015 })], {}, at);
  near(m.sample(at)[0].longitude, displayed.longitude);
  near(m.sample(at)[0].bearing!, displayed.bearing!);
  assert.ok(m.sample(at + 200)[0].longitude > displayed.longitude);
});

test("repeated snapshots and age ticks do not restart movement", () => {
  const m = new LiveMotion();
  const first = bus();
  m.update([first], {}, 0);
  const next = later(first, { longitude: 106.801 });
  m.update([next], {}, 100);
  m.update([{ ...next }], { [next.id]: 500 }, 500);
  near(m.sample(100 + GLIDE)[0].longitude, next.longitude);
  assert.equal(m.isMoving(100 + GLIDE), false);
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
