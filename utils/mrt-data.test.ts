import assert from "node:assert/strict";
import test from "node:test";
import { bakeMrt, MRT_RELATIONS, type OsmMrtDocument } from "./mrt-data";

// Small, offline OSM fixture: route geometry contains terminal overhangs and
// ways stored backwards, as in the real relation. No live API in tests.
function fixture(reverse = false): OsmMrtDocument {
  const stations = [
    "Lebak Bulus",
    "Fatmawati",
    "Cipete Raya",
    "Haji Nawi",
    "Blok A",
    "Blok M",
    "ASEAN",
    "Senayan",
    "Istora",
    "Bendungan Hilir",
    "Setiabudi",
    "Dukuh Atas",
    "Bundaran HI",
  ];
  const nodes = Array.from({ length: 15 }, (_, i) => ({
    type: "node" as const,
    id: i + 1,
    lon: 106.8,
    lat: -6.3 + i * 0.005,
    ...(i > 0 && i < 14 ? { tags: { name: stations[i - 1] } } : {}),
  }));
  const calls = nodes
    .slice(1, 14)
    .map((node) => ({ type: "node" as const, ref: node.id, role: "stop" }));
  if (reverse) calls.reverse();
  return {
    elements: [
      ...nodes,
      {
        type: "way",
        id: 100,
        nodes: nodes
          .slice(0, 8)
          .map((n) => n.id)
          .reverse(),
        tags: { railway: "subway" },
      },
      {
        type: "way",
        id: 101,
        nodes: nodes.slice(7).map((n) => n.id),
        tags: { railway: "subway" },
      },
      {
        type: "relation",
        id: MRT_RELATIONS[reverse ? 1 : 0],
        tags: { route: "subway", network: "MRT Jakarta", colour: "#CE0037" },
        members: [
          ...calls,
          { type: "way", ref: 100, role: "" },
          { type: "way", ref: 101, role: "" },
        ],
      },
    ],
  };
}

test("MRT bakes the operating line with thirteen stops and two real directions", () => {
  const result = bakeMrt([fixture(), fixture(true)]);
  const route = result.route;
  const ids = Array.from(
    { length: 13 },
    (_, i) => `NS${String(i + 1).padStart(2, "0")}`,
  );
  assert.equal(route.route_id, "M");
  assert.equal(route.route_color, "CE0037");
  assert.deepEqual(
    route.stops.map((s) => s.stop_id),
    ids,
  );
  assert.deepEqual(
    route.variants.map((v) => v.stopIds),
    [ids, [...ids].reverse()],
  );
  assert.deepEqual(
    route.variants.map((v) => v.headsign),
    ["Bundaran HI", "Lebak Bulus"],
  );
  assert.ok(
    route.variants.every(
      (v) => v.headwaySecs === null && v.windows.length === 0,
    ),
  );
  assert.equal(result.stations.length, 13);
  assert.equal(result.stopLayer.features.length, 13);
  assert.equal(result.overview.features.length, 2);
  for (const variant of route.variants) {
    const shape = route.geometryByShape[variant.shape_id];
    const first = route.stops.find((s) => s.stop_id === variant.stopIds[0])!;
    const last = route.stops.find((s) => s.stop_id === variant.stopIds.at(-1))!;
    assert.deepEqual(shape[0], [first.stop_lon, first.stop_lat]);
    assert.deepEqual(shape.at(-1), [last.stop_lon, last.stop_lat]);
    assert.ok(shape.every((p) => p[1] >= -6.295 && p[1] <= -6.235));
  }
});

test("MRT rejects incomplete calls, unfinished track, and missing/disconnected ways", () => {
  const incomplete = fixture();
  const relation = incomplete.elements.find((e) => e.type === "relation")!;
  assert.ok(relation.type === "relation");
  relation.members.splice(0, 1);
  assert.throws(() => bakeMrt([incomplete, fixture(true)]), /13 open stations/);

  const unfinished = fixture();
  const way = unfinished.elements.find((e) => e.type === "way")!;
  assert.ok(way.type === "way");
  way.tags = { railway: "construction" };
  assert.throws(
    () => bakeMrt([unfinished, fixture(true)]),
    /not operating subway/,
  );

  const missing = fixture();
  missing.elements = missing.elements.filter(
    (e) => e.type !== "way" || e.id !== 101,
  );
  assert.throws(() => bakeMrt([missing, fixture(true)]), /missing track way/);

  const disconnected = fixture();
  const secondWay = disconnected.elements.find(
    (e) => e.type === "way" && e.id === 101,
  )!;
  assert.ok(secondWay.type === "way");
  secondWay.nodes = secondWay.nodes.slice(2);
  assert.throws(() => bakeMrt([disconnected, fixture(true)]), /disconnected/);
});

test("MRT markers sit midway between both direction stops in every station layer", () => {
  const outbound = fixture();
  const inbound = fixture(true);
  // Distinct parallel tracks, plus slightly staggered platform positions.
  for (const element of inbound.elements) {
    if (element.type === "node") {
      element.lon += 0.0002;
      element.lat += 0.00002;
    }
  }
  const baseline = bakeMrt([outbound, fixture(true)]);
  const { route, stations, stopLayer } = bakeMrt([outbound, inbound]);
  for (let i = 0; i < route.stops.length; i++) {
    const stop = route.stops[i];
    const expectedLon = 106.8001;
    const expectedLat = Number((-6.3 + (i + 1) * 0.005 + 0.00001).toFixed(7));
    assert.equal(stop.stop_lon, expectedLon);
    assert.equal(stop.stop_lat, expectedLat);
    assert.equal(stations[i].lon, expectedLon);
    assert.equal(stations[i].lat, expectedLat);
    assert.deepEqual(stopLayer.features[i].geometry.coordinates, [
      expectedLon,
      expectedLat,
    ]);
  }
  // Centering the marker must not move the northbound railway itself.
  const interior = (line: [number, number][]) =>
    line.filter(([, lat]) => lat > -6.295 + 0.0001 && lat < -6.235 - 0.0001);
  assert.deepEqual(
    interior(route.geometryByShape["M-0"]),
    interior(baseline.route.geometryByShape["M-0"]),
  );
  // Both trimmed terminal shapes still meet the shared station marker.
  for (const variant of route.variants) {
    const first = route.stops.find((s) => s.stop_id === variant.stopIds[0])!;
    const last = route.stops.find((s) => s.stop_id === variant.stopIds.at(-1))!;
    const shape = route.geometryByShape[variant.shape_id];
    assert.deepEqual(shape[0], [first.stop_lon, first.stop_lat]);
    assert.deepEqual(shape.at(-1), [last.stop_lon, last.stop_lat]);
  }
});
