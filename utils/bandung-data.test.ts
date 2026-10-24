import { readFileSync } from "node:fs";

/** A baked station entry, by name, from one mode's index. */
const stationEntry = (mode: string, name: string) => {
  const stations = JSON.parse(
    readFileSync(`data/${mode}/stops.json`, "utf8"),
  ) as { name: string; routes: string[] }[];
  return stations.find((s) => s.name === name);
};

import assert from "node:assert/strict";
import test from "node:test";
import {
  BANDUNG_SYSTEMS,
  bakeBandung,
  type BandungSystem,
} from "./bandung-data";
import { CITIES, CITY_MODES, cityForMode, cityModes, isCity } from "./cities";
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

test("the city registry is the only place a dataset is assigned to a city", () => {
  // Every mode must belong to exactly one city: an unregistered mode would
  // otherwise be searched with another city's datasets and map credit.
  for (const mode of TRANSIT_MODES) {
    const owners = CITIES.filter((city) =>
      (CITY_MODES[city] as readonly string[]).includes(mode),
    );
    assert.equal(owners.length, 1, `${mode} must belong to exactly one city`);
    assert.equal(cityForMode(mode), owners[0]);
  }
  // A future city is a single entry in CITY_MODES; nothing here should need a
  // second hardcoded list.
  assert.deepEqual(CITIES, Object.keys(CITY_MODES));
  assert.equal(isCity("jakarta"), true);
  assert.equal(isCity("bandung"), true);
  assert.equal(isCity("surabaya"), false);
  assert.equal(isCity(null), false);
  // Unknown modes are a programming error, not a silent fallback to Jakarta.
  assert.throws(() => cityForMode("surabaya" as never));
});

test("Bandung city owns only Bandung modes; Jakarta mode list remains intact", () => {
  assert.deepEqual(CITY_MODES.jakarta, ["krl", "mrt", "lrt", "lrtj", "gtfs"]);
  assert.deepEqual(CITY_MODES.bandung, [
    "bdg-kci",
    "bdg-kai",
    "bdg-mjt",
    "bdg-tmb",
    "bdg-damri",
    "bdg-angkot",
  ]);
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
      // Angkot is community-mapped and many corridors carry only their two
      // termini; every other operator is expected to have real intermediates.
      const minimumStops = mode === "bdg-angkot" ? 2 : 3;
      assert.ok(
        detail && detail.stops.length >= minimumStops,
        `${mode}:${summary.route_id} has ${detail?.stops.length} stops`,
      );
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
  assert.deepEqual(
    (await getRouteIndex("bdg-tmb")).map((r) => r.route_id),
    ["K1", "K2", "K3", "K4", "K5", "F1", "F2"],
  );
  assert.deepEqual(
    (await getRouteIndex("bdg-damri")).map((r) => r.route_id),
    ["2", "6A", "8", "11", "KBP"],
  );
  const k1 = await getRouteDetail("K1", "bdg-tmb");
  assert.equal(k1?.variants.length, 2);
  const k1Name = new Map(k1!.stops.map((st) => [st.stop_id, st.stop_name]));
  // Bus directions use different streets, so they are not reverses of each
  // other -- but each must still start where the other ends.
  const [out, back] = k1!.variants.map((v) => [
    k1Name.get(v.stopIds[0]),
    k1Name.get(v.stopIds.at(-1)!),
  ]);
  assert.deepEqual(out, [back[1], back[0]]);
  assert.ok(k1!.variants.every((v) => v.stopIds.length > 20));
  assert.ok(
    k1!.variants.every((v) => v.headwaySecs === null && v.windows.length === 0),
  );
  assert.ok(
    [...k1Name.values()].some((name) => name.includes("Cibiru")),
    "K1 must still reach Cibiru",
  );
  const angkot = await getRouteIndex("bdg-angkot");
  assert.equal(angkot.length, 107);
  // OSM reuses trayek numbers, so a number can cover several corridors.
  // They must stay separate lines, never one route spanning the city.
  const angkot08 = angkot.filter((r) => /^08(-|$)/.test(r.route_id));
  assert.deepEqual(
    angkot08.map((r) => [r.route_id, r.route_short_name, r.route_long_name]),
    [
      ["08", "08", "Cicaheum/Kircon - Cibaduyut"],
      ["08-2", "08", "Rancakalong - Tanjung Sari"],
      ["08-3", "08", "Leuwipanjang - Cangkuang"],
    ],
  );
  // The operator's number is the badge, repeats included: three 08 services in
  // three parts of the region really are all "08". A synthetic id must never
  // leak into what a rider reads.
  assert.equal(
    angkot.filter((r) => r.route_short_name.includes("-")).length,
    0,
  );
  assert.ok(
    BANDUNG_SYSTEMS["bdg-angkot"].every(
      (line) => line.short && line.short.length <= 4,
    ),
    "badges must fit the round badge",
  );
  // Corridors with no short code derive an acronym, and those must not collide.
  const derived = BANDUNG_SYSTEMS["bdg-angkot"].filter(
    (line) => (line.refs?.[0] ?? line.id).length > 4,
  );
  const derivedShorts = derived.map((line) => line.short);
  assert.ok(derived.length > 0);
  assert.equal(new Set(derivedShorts).size, derivedShorts.length);
  const rancakalong = stationEntry("bdg-angkot", "Rancakalong");
  assert.deepEqual(rancakalong?.routes, ["08-2"]);
  // Suffix ids must never take a genuine ref's place.
  const genuine = new Set(
    BANDUNG_SYSTEMS["bdg-angkot"].map((line) => line.refs?.[0] ?? line.id),
  );
  const synthetic = BANDUNG_SYSTEMS["bdg-angkot"].filter(
    (line) => line.id !== (line.refs?.[0] ?? line.id),
  );
  assert.ok(synthetic.length > 0);
  for (const line of synthetic) {
    assert.ok(!genuine.has(line.id), `${line.id} shadows a genuine ref`);
    assert.match(line.id, /-\d+$/);
  }
  assert.ok(
    angkot.every((r) => r.route_short_name.length <= 4),
    "angkot badges must fit the round badge",
  );
  const sampleAngkot = await getRouteDetail(angkot[0].route_id, "bdg-angkot");
  assert.ok(sampleAngkot && sampleAngkot.variants.every((v) => v.headwaySecs === null));
  const damri2 = await getRouteDetail("2", "bdg-damri");
  assert.equal(
    (await getRouteIndex("bdg-damri")).find((r) => r.route_id === "2")
      ?.route_desc,
    "Bus Kota DAMRI · Perum DAMRI",
  );
  assert.equal(damri2?.variants.every((v) => v.headwaySecs === null), true);
  assert.equal(
    (await getRouteIndex("bdg-tmb")).every(
      (r) => r.route_desc.startsWith("Trans Metro Bandung"),
    ),
    true,
  );
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
