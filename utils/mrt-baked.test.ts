import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FeatureCollection, LineString } from "geojson";
import type { RouteDetail, StationIndexEntry } from "./types/gtfs";

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(`data/mrt/${name}`, "utf8")) as T;
const route = load<RouteDetail>("routes/M.json");
const stations = load<StationIndexEntry[]>("stops.json");
const overview = load<FeatureCollection<LineString>>("overview.json");
const metres = (a: number[], b: number[]) =>
  Math.hypot((a[0] - b[0]) * 110_700, (a[1] - b[1]) * 110_540);

// Independent service order: prevent NS codes drifting when OSM members change.
const bases = [
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
test("baked MRT has only the 13 operating North–South stations and their searchable index", () => {
  assert.equal(route.stops.length, 13);
  assert.equal(stations.length, 13);
  assert.equal(route.route_id, "M");
  assert.equal(route.route_color, "CE0037");
  route.stops.forEach((stop, i) => {
    assert.equal(stop.stop_id, `NS${String(i + 1).padStart(2, "0")}`);
    assert.ok(stop.stop_name.startsWith(bases[i]));
    const station = stations.find((s) => s.name === stop.stop_name)!;
    assert.deepEqual(station.routes, ["M"]);
    assert.deepEqual(station.positions.M, [i + 1, 13]);
    assert.ok(
      metres([stop.stop_lon, stop.stop_lat], [station.lon, station.lat]) < 1,
    );
  });
  assert.ok(route.stops[0].stop_lat < -6.28);
  assert.ok(route.stops.at(-1)!.stop_lat > -6.2);
  assert.ok(
    !stations.some((s) =>
      /Thamrin|Monas|Harmoni|Sawah Besar|Mangga Besar|Glodok|Kota/i.test(
        s.name,
      ),
    ),
  );
});

test("both MRT direction tracks are continuous, trimmed to terminals and present in the overview", () => {
  assert.equal(overview.features.length, 2);
  assert.equal(route.variants.length, 2);
  assert.deepEqual(
    route.variants[0].stopIds,
    route.stops.map((s) => s.stop_id),
  );
  assert.deepEqual(
    route.variants[1].stopIds,
    [...route.variants[0].stopIds].reverse(),
  );
  for (const [i, variant] of route.variants.entries()) {
    assert.equal(variant.headwaySecs, null);
    assert.deepEqual(variant.windows, []);
    const shape = route.geometryByShape[variant.shape_id];
    assert.ok(shape.length > 100);
    let length = 0;
    for (let j = 1; j < shape.length; j++) {
      const segment = metres(shape[j - 1], shape[j]);
      assert.ok(
        segment < 1000,
        `${variant.shape_id}: unexpected track jump ${segment}m`,
      );
      length += segment;
    }
    assert.ok(length > 14000 && length < 18000, `MRT line length ${length}m`);
    const first = route.stops.find((s) => s.stop_id === variant.stopIds[0])!;
    const last = route.stops.find((s) => s.stop_id === variant.stopIds.at(-1))!;
    assert.ok(metres(shape[0], [first.stop_lon, first.stop_lat]) < 1);
    assert.ok(metres(shape.at(-1)!, [last.stop_lon, last.stop_lat]) < 1);
    assert.deepEqual(overview.features[i].geometry.coordinates, shape);
    assert.equal(overview.features[i].properties?.color, "#CE0037");
  }
});
