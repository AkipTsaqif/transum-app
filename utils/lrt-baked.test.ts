import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FeatureCollection, LineString } from "geojson";
import type { RouteDetail, StationIndexEntry } from "./types/gtfs";

// Two systems, two datasets: LRT Jakarta (Jakpro) and LRT Jabodebek (PT KAI).
const load = <T>(dir: "lrt" | "lrtj", name: string): T =>
  JSON.parse(readFileSync(`data/${dir}/${name}`, "utf8")) as T;
const DIR = { J: "lrt", CB: "lrtj", BK: "lrtj" } as const;
const line = (id: keyof typeof DIR) =>
  load<RouteDetail>(DIR[id], `routes/${id}.json`);
const stations = (dir: "lrt" | "lrtj") =>
  load<StationIndexEntry[]>(dir, "stops.json");
const overview = (dir: "lrt" | "lrtj") =>
  load<FeatureCollection<LineString>>(dir, "overview.json");
const metres = (a: number[], b: number[]) =>
  Math.hypot((a[0] - b[0]) * 110_700, (a[1] - b[1]) * 110_540);

// Independent of the baker: published station counts per line.
const EXPECTED = { J: 11, CB: 12, BK: 14 } as const;

test("each line has its published station count and ordered ids", () => {
  for (const [id, count] of Object.entries(EXPECTED) as [
    keyof typeof DIR,
    number,
  ][]) {
    const route = line(id);
    assert.equal(route.stops.length, count, `${id} station count`);
    assert.deepEqual(
      route.stops.map((s) => s.stop_id),
      Array.from(
        { length: count },
        (_, i) => `${id}${String(i + 1).padStart(2, "0")}`,
      ),
    );
    assert.equal(route.variants.length, 2);
    assert.deepEqual(
      route.variants[1].stopIds,
      [...route.variants[0].stopIds].reverse(),
    );
    assert.ok(
      route.variants.every(
        (v) => v.headwaySecs === null && v.windows.length === 0,
      ),
    );
  }
});

test("the two systems are separate datasets with no shared line or station", () => {
  const routes = (dir: "lrt" | "lrtj") =>
    load<{ route_id: string }[]>(dir, "routes.json").map((r) => r.route_id);
  assert.deepEqual(routes("lrt"), ["J"]);
  assert.deepEqual(routes("lrtj"), ["CB", "BK"]);
  assert.equal(stations("lrt").length, 11);
  assert.equal(stations("lrtj").length, 18); // KAI's published 18 stations
  assert.ok(stations("lrt").every((s) => s.routes.join() === "J"));
  assert.ok(!stations("lrtj").some((s) => s.routes.includes("J")));
  // Each system's files hold no route detail from the other.
  assert.throws(() => readFileSync("data/lrt/routes/CB.json"));
  assert.throws(() => readFileSync("data/lrtj/routes/J.json"));
});

test("terminals are correct and only operating stations are present", () => {
  assert.deepEqual(
    [line("J").stops[0].stop_name, line("J").stops.at(-1)!.stop_name],
    ["Manggarai", "Kelapa Gading"],
  );
  assert.equal(line("CB").stops.at(-1)!.stop_name, "Harjamukti");
  assert.equal(line("BK").stops.at(-1)!.stop_name, "Jatimulya");
  assert.ok(line("CB").stops[0].stop_name.startsWith("Dukuh Atas"));
  // Planned/unbuilt LRT Jakarta stations and the Jabodebek extension.
  const all = [...stations("lrt"), ...stations("lrtj")];
  assert.ok(
    !all.some((s) =>
      /Pegangsaan Dua|Kemayoran|Monas|Gelora|Senayan|Grogol|Mangga Dua|Palmerah/i.test(
        s.name,
      ),
    ),
  );
});

test("Cibubur and Bekasi share eight trunk stations within LRT Jabodebek", () => {
  const jb = stations("lrtj");
  assert.equal(jb.length, 12 + 14 - 8);
  const shared = jb.filter((s) => s.routes.length > 1);
  assert.equal(shared.length, 8);
  for (const s of shared) assert.deepEqual(s.routes, ["BK", "CB"]);
  const names = shared
    .map((s) => s.name.replace(/ Bank Syariah Indonesia$/, ""))
    .sort();
  assert.deepEqual(names, [
    "Cawang",
    "Cikoko",
    "Ciliwung",
    "Dukuh Atas",
    "Kuningan",
    "Pancoran",
    "Rasuna Said",
    "Setiabudi",
  ]);
  // Lookup parity: each system's index agrees with its lines' stop lists.
  for (const id of Object.keys(EXPECTED) as (keyof typeof DIR)[]) {
    for (const stop of line(id).stops) {
      const s = stations(DIR[id]).find((x) => x.name === stop.stop_name)!;
      assert.ok(s.routes.includes(id));
      assert.ok(metres([stop.stop_lon, stop.stop_lat], [s.lon, s.lat]) < 1);
    }
  }
});

test("tracks are continuous, trimmed to terminals, and in their system's overview", () => {
  assert.deepEqual(
    overview("lrt")
      .features.map((f) => f.properties?.color)
      .sort(),
    ["#F16227", "#F16227"],
  );
  assert.deepEqual(
    overview("lrtj")
      .features.map((f) => f.properties?.color)
      .sort(),
    ["#0E6938", "#0E6938", "#20409A", "#20409A"],
  );
  // LRT Jakarta is a single line and must never carry a trunk offset.
  assert.ok(
    overview("lrt").features.every(
      (f) => f.properties?.lineOffset === undefined,
    ),
  );
  assert.ok(
    overview("lrtj").features.every(
      (f) => typeof f.properties?.lineOffset === "number",
    ),
  );
  const lengthKm: Record<string, [number, number]> = {
    J: [10.5, 13],
    CB: [23.5, 25.5],
    BK: [26.5, 28.5],
  };
  for (const id of Object.keys(EXPECTED) as (keyof typeof DIR)[]) {
    const route = line(id);
    for (const variant of route.variants) {
      const shape = route.geometryByShape[variant.shape_id];
      let length = 0;
      for (let i = 1; i < shape.length; i++) {
        const seg = metres(shape[i - 1], shape[i]);
        assert.ok(seg < 2000, `${variant.shape_id} jumps ${seg}m`);
        length += seg;
      }
      const [lo, hi] = lengthKm[id];
      assert.ok(
        length / 1000 > lo && length / 1000 < hi,
        `${id} ${(length / 1000).toFixed(1)} km`,
      );
      const first = route.stops.find((s) => s.stop_id === variant.stopIds[0])!;
      const last = route.stops.find(
        (s) => s.stop_id === variant.stopIds.at(-1),
      )!;
      assert.ok(metres(shape[0], [first.stop_lon, first.stop_lat]) < 1);
      assert.ok(metres(shape.at(-1)!, [last.stop_lon, last.stop_lat]) < 1);
    }
  }
  // Both Jabodebek lines run the same trunk: their Dukuh Atas ends coincide.
  assert.ok(
    metres(
      line("CB").geometryByShape["CB-0"][0],
      line("BK").geometryByShape["BK-0"][0],
    ) < 1,
  );
});
