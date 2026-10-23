import assert from "node:assert/strict";
import test from "node:test";
import {
  BANDUNG_SYSTEMS,
  bakeBandung,
  type BandungSystem,
} from "./bandung-data";
import { CITY_MODES, cityForMode, cityModes } from "./cities";
import {
  TRANSIT_MODES,
  getRouteDetail,
  getRouteIndex,
  getStopLayer,
  getOverview,
  getNearbyStations,
  searchStations,
  resolveStation,
} from "../lib/gtfs";
import type { FeatureCollection } from "geojson";
import type { OsmDocument } from "./rail-geometry";

test("Bandung city owns only Bandung modes; Jakarta mode list remains intact", () => {
  assert.deepEqual(CITY_MODES.jakarta, ["krl", "mrt", "lrt", "lrtj", "gtfs"]);
  assert.deepEqual(CITY_MODES.bandung, ["bdg-kci", "bdg-kai", "bdg-mjt"]);
  assert.equal(cityForMode("krl"), "jakarta");
  assert.equal(cityForMode("bdg-mjt"), "bandung");
  assert.ok(CITY_MODES.bandung.every((m) => TRANSIT_MODES.includes(m)));
});

test("baked Bandung systems contain only validated route ids and usable geometry", async () => {
  for (const mode of CITY_MODES.bandung) {
    const lines = BANDUNG_SYSTEMS[mode];
    const routes = await getRouteIndex(mode);
    assert.deepEqual(
      routes.map((r) => r.route_id),
      lines.map((l) => l.id),
    );
    const layer = (await getStopLayer(mode)) as FeatureCollection;
    const overview = await getOverview(mode);
    assert.ok(layer.features.length >= 3);
    assert.equal(
      overview.features.length,
      lines.reduce((n, l) => n + l.relations.length, 0),
    );
    for (const summary of routes) {
      const detail = await getRouteDetail(summary.route_id, mode);
      assert.ok(detail && detail.stops.length >= 3);
      assert.ok(
        detail.variants.every(
          (v) => v.headwaySecs === null && v.windows.length === 0,
        ),
      );
      assert.ok(detail.variants.every((v) => v.stopIds.length === v.stopCount));
      assert.ok(
        detail.variants.every(
          (v) => (detail.geometryByShape[v.shape_id] ?? []).length > 2,
        ),
      );
    }
    assert.equal(await getRouteDetail("INVALID", mode), null);
  }
  assert.deepEqual(
    (await getRouteIndex("bdg-kci")).map((r) => r.route_id),
    ["B", "C"],
  );
  assert.equal((await getRouteDetail("C", "bdg-kci"))?.stops.length, 30);
  assert.equal((await getRouteDetail("KC", "bdg-kai"))?.stops.length, 3);
  assert.equal((await getRouteDetail("FD1", "bdg-mjt"))?.variants.length, 2);
  assert.equal((await searchStations("Cicalengka", 20, "bdg-kci")).length, 1);
  assert.equal(
    (await resolveStation("Bandung", -6.912, 107.601, "bdg-kci"))?.name,
    "Bandung",
  );
  const bandung = await getNearbyStations(
    -6.912,
    107.601,
    500,
    CITY_MODES.bandung,
  );
  assert.ok(bandung.length > 0);
  assert.ok(bandung.every((s) => cityModes("bandung").includes(s.mode)));
  assert.ok(
    !(await getNearbyStations(-6.912, 107.601, 500, CITY_MODES.jakarta)).some(
      (s) => s.mode === "bdg-kci",
    ),
  );
});

test("baker rejects missing relations and disconnected or reordered track", () => {
  assert.throws(
    () => bakeBandung([], BANDUNG_SYSTEMS["bdg-kci"]),
    /Missing Bandung relations/,
  );
  const line = {
    id: "X",
    name: "Test",
    kind: "train" as const,
    color: "123456",
    relations: [42],
    stations: ["First", "Middle", "Last"],
  };
  const document: OsmDocument = {
    elements: [
      ...[1, 2, 3, 4, 5].map((id) => ({
        type: "node" as const,
        id,
        lon: 107.5 + id * 0.001,
        lat: -6.9,
        tags: { name: ["First", "Middle", "Last"][id - 1] ?? `Node ${id}` },
      })),
      { type: "way", id: 10, nodes: [1, 2], tags: { railway: "rail" } },
      { type: "way", id: 11, nodes: [2, 3], tags: { railway: "rail" } },
      {
        type: "relation",
        id: 42,
        tags: { route: "train", network: "KAI Commuter", ref: "X" },
        members: [
          ...[1, 2, 3].map((ref) => ({
            type: "node" as const,
            ref,
            role: "stop",
          })),
          { type: "way", ref: 10, role: "" },
          { type: "way", ref: 11, role: "" },
        ],
      },
    ],
  };
  assert.equal(bakeBandung([document], [line]).stations.length, 3);
  const disconnected = structuredClone(document);
  const way = disconnected.elements.find(
    (e) => e.type === "way" && e.id === 11,
  );
  if (!way || way.type !== "way") throw new Error("Test fixture is invalid");
  way.nodes = [4, 3];
  assert.throws(() => bakeBandung([disconnected], [line]), /disconnected/);
  const reordered = structuredClone(document);
  const relation = reordered.elements.find(
    (e) => e.type === "relation" && e.id === 42,
  );
  if (!relation || relation.type !== "relation")
    throw new Error("Test fixture is invalid");
  [relation.members[1], relation.members[2]] = [
    relation.members[2],
    relation.members[1],
  ];
  assert.throws(() => bakeBandung([reordered], [line]), /station order/);
});
