import assert from "node:assert/strict";
import test from "node:test";
import type { TransitMode } from "@/lib/gtfs";
import type { RouteSummary } from "./types/gtfs";
import {
  connectionsAnchor,
  walkingConnections,
  walkRadiusRing,
  WALKING_RADIUS_M,
} from "./nearby";

const route = (id: string): RouteSummary => ({
  route_id: id,
  route_short_name: id,
  route_long_name: `Route ${id}`,
  route_desc: "",
  route_color: "000000",
  route_text_color: "FFFFFF",
});

const stop = (
  mode: TransitMode,
  name: string,
  distance: number,
  routes: string[],
) => ({
  mode,
  name,
  lat: -6.2,
  lon: 106.82,
  distance,
  routes: routes.map(route),
});

// Sudirman serves only the Cikarang KRL line.
const clicked = {
  mode: "krl" as TransitMode,
  name: "Sudirman",
  lat: -6.202,
  lon: 106.8228,
  routes: [route("C")],
};

test("a nearer stop claims a shared route; the farther twin is dropped entirely", () => {
  // The owner's own example: Transport Hub Dukuh Atas (78 m) and Taman Kudus
  // (140 m) both serve 1B. Only the closest may list it, and Taman Kudus has
  // nothing left once 1B is claimed.
  const list = walkingConnections(clicked, [
    stop("gtfs", "Taman Kudus", 140, ["1B"]),
    stop("gtfs", "Transport Hub Dukuh Atas", 78, ["1B"]),
    stop("gtfs", "Galunggung", 219, ["4", "6", "B25"]),
  ]);
  assert.deepEqual(
    list.map((c) => [c.name, c.routes.map((r) => r.route_id)]),
    [
      ["Transport Hub Dukuh Atas", ["1B"]],
      ["Galunggung", ["4", "6", "B25"]],
    ],
  );
});

test("a same-mode stop shows up when it serves a different service", () => {
  // BNI City is KRL like Sudirman, but the airport line (A) is a different
  // service; its C is already Sudirman's own line and must not be repeated.
  const list = walkingConnections(clicked, [
    stop("krl", "BNI City", 423, ["A", "C"]),
  ]);
  assert.deepEqual(list, [
    {
      mode: "krl",
      name: "BNI City",
      lat: -6.2,
      lon: 106.82,
      distance: 423,
      routes: [route("A")],
    },
  ]);
});

test("a stop keeps only the routes no closer stop serves", () => {
  // Tosari 1 overlaps on 1B with the hub but uniquely serves BW4.
  const list = walkingConnections(clicked, [
    stop("gtfs", "Transport Hub Dukuh Atas", 78, ["1B"]),
    stop("gtfs", "Tosari 1", 360, ["1B", "BW4"]),
    stop("gtfs", "Dukuh Atas 4", 304, ["1P", "1T", "4C", "9D"]),
    stop("gtfs", "Tosari 2", 392, ["1P", "1T", "4C", "9D", "BW4"]),
  ]);
  assert.deepEqual(
    list.map((c) => [c.name, c.routes.map((r) => r.route_id)]),
    [
      ["Transport Hub Dukuh Atas", ["1B"]],
      ["Dukuh Atas 4", ["1P", "1T", "4C", "9D"]],
      ["Tosari 1", ["BW4"]],
    ],
  );
});

test("the radius is 500 m straight-line and the clicked stop itself is ignored", () => {
  assert.equal(WALKING_RADIUS_M, 500);
  const list = walkingConnections(clicked, [
    stop("krl", "Sudirman", 0, ["C"]), // the clicked stop itself
    stop("gtfs", "At the edge", 500, ["1"]),
    stop("gtfs", "Just too far", 501, ["2"]),
    stop("gtfs", "Clearly far", 900, ["3"]),
  ]);
  assert.deepEqual(
    list.map((c) => c.name),
    ["At the edge"],
  );
  // A smaller radius narrows the search without changing the rule.
  assert.deepEqual(
    walkingConnections(
      clicked,
      [
        stop("gtfs", "At the edge", 500, ["1"]),
        stop("gtfs", "Near", 200, ["2"]),
      ],
      300,
    ).map((c) => c.name),
    ["Near"],
  );
});

test("the same route id in two systems counts as two different services", () => {
  // Route ids are unique across the five datasets today, but the rule is
  // keyed by (mode, route): a hypothetical bus "M" is not the metro's M.
  const list = walkingConnections(clicked, [
    stop("mrt", "MRT M", 200, ["M"]),
    stop("gtfs", "Bus M", 100, ["M"]),
  ]);
  assert.deepEqual(
    list.map((c) => [c.name, c.routes.map((r) => r.route_id)]),
    [
      ["Bus M", ["M"]],
      ["MRT M", ["M"]],
    ],
  );
});

test("no candidates, only duplicates, or empty inputs are all safe", () => {
  assert.deepEqual(walkingConnections(clicked, []), []);
  assert.deepEqual(
    walkingConnections(clicked, [stop("krl", "Sudirman", 0, ["C"])]),
    [],
  );
  assert.deepEqual(
    walkingConnections(clicked, [
      // Same mode AND same route: nothing new. (A route with the same id in
      // another system is a different service -- see the test above.)
      stop("krl", "Cikarang-line twin", 50, ["C"]),
    ]),
    [],
    "a stop serving nothing new is not worth listing",
  );
});

test("the walk ring is a closed 500 m circle in lon/lat", () => {
  const ring = walkRadiusRing(-6.202, 106.8228);
  assert.equal(ring.length, 65, "64 segments, closed");
  assert.deepEqual(ring[0], ring.at(-1));
  // Every vertex is the radius away from the centre, on the ground.
  const metres = (a: number[], b: number[]) =>
    Math.hypot(
      (a[0] - b[0]) * 111_320 * Math.cos((-6.202 * Math.PI) / 180),
      (a[1] - b[1]) * 110_540,
    );
  for (const vertex of ring) {
    assert.ok(
      Math.abs(metres(vertex, [106.8228, -6.202]) - WALKING_RADIUS_M) < 1,
    );
  }
  // Points are lon/lat, not lat/lon.
  assert.ok(
    ring.every(
      ([lon, lat]) =>
        Math.abs(lon - 106.8228) < 0.01 && Math.abs(lat + 6.202) < 0.01,
    ),
  );
});

test("the popup anchors to the corner opposite the connection cluster", () => {
  const station = { lat: -6.202, lon: 106.8228 };
  // Dots north-east of the station -> card goes south-west -> anchor top-right.
  const dots = (dLat: number, dLon: number) => [
    { lat: station.lat + dLat, lon: station.lon + dLon },
  ];
  assert.equal(connectionsAnchor(station, dots(0.004, 0.004)), "top-right");
  // Dots south-west -> card north-east -> anchor bottom-left.
  assert.equal(connectionsAnchor(station, dots(-0.004, -0.004)), "bottom-left");
  assert.equal(connectionsAnchor(station, dots(0.004, -0.004)), "top-left");
  assert.equal(connectionsAnchor(station, dots(-0.004, 0.004)), "bottom-right");
  // Spread east and west but all north: longitude cancels and the tie goes
  // south-west ("top-right"), which still keeps the card clear of a cluster
  // sitting north of the station.
  assert.equal(
    connectionsAnchor(station, [...dots(0.004, 0.004), ...dots(0.004, -0.004)]),
    "top-right",
  );
  // Longitude is compressed by latitude, so a far-east dot still counts east.
  assert.equal(connectionsAnchor(station, dots(0, 0.01)), "top-right");
});

test("the card avoids the side holding the dots, even the near ones", () => {
  const station = { lat: -6.202, lon: 106.8228 };
  // Galunggung's real layout: two near stops south-west, the rest north and
  // east. The centroid points north-east, which would put the card over the
  // two near ones; the count rule keeps them visible.
  const southWestNear = [
    { lat: station.lat - 0.001, lon: station.lon - 0.001 },
    { lat: station.lat - 0.0012, lon: station.lon - 0.0008 },
  ];
  const farSpread = [
    { lat: station.lat + 0.004, lon: station.lon + 0.001 }, // north
    { lat: station.lat + 0.001, lon: station.lon + 0.004 }, // east
    { lat: station.lat + 0.003, lon: station.lon + 0.003 }, // north-east
  ];
  const anchor = connectionsAnchor(station, [...southWestNear, ...farSpread]);
  // Card must NOT sit south-west (that anchor is "top-right").
  assert.notEqual(anchor, "top-right");
  // And the chosen corner must be one that covers no dots at all: south-west
  // (top-right) and north-east (bottom-left) each swallow some.
  const bearing = (c: { lat: number; lon: number }) => {
    const east =
      (c.lon - station.lon) * 111_320 * Math.cos((station.lat * Math.PI) / 180);
    const north = (c.lat - station.lat) * 110_540;
    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  };
  const covers = {
    "bottom-right": (b: number) => b >= 270,
    "top-right": (b: number) => b >= 180 && b < 270,
    "bottom-left": (b: number) => b < 90,
    "top-left": (b: number) => b >= 90 && b < 180,
  } as const;
  const covered = [...southWestNear, ...farSpread].filter((c) =>
    covers[anchor](bearing(c)),
  ).length;
  assert.equal(covered, 0, `anchor ${anchor} covers ${covered} dots`);
});
