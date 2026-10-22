import assert from "node:assert/strict";
import test from "node:test";
import {
  bakeLrt,
  LRT_LINES,
  LRT_SYSTEMS,
  type LrtLine,
  type OsmLrtDocument,
} from "./lrt-data";

// Offline fixture shaped like the real relations: one trunk shared by two
// lines (Dukuh Atas -> Cawang) that then forks, plus a separate Jakpro line.
// Tracks are straight lines on distinct longitudes so geometry is checkable.
type Station = { name: string; lon: number; lat: number };
let nextId = 1;
const id = () => nextId++;

function build(
  relationId: number,
  stations: Station[],
  opts: {
    spur?: boolean;
    railway?: string;
    network?: string;
    skewMetres?: number;
  } = {},
): OsmLrtDocument {
  const skew = (opts.skewMetres ?? 0) / 110_700;
  const nodes = stations.map((s) => ({
    type: "node" as const,
    id: id(),
    lon: s.lon + skew,
    lat: s.lat,
    tags: { name: s.name },
  }));
  const trackNodes = [...nodes];
  if (opts.spur) {
    // Dead-end track past the last platform (buffer stops / depot lead).
    const last = nodes.at(-1)!;
    trackNodes.push({
      type: "node",
      id: id(),
      lon: last.lon,
      lat: last.lat + 0.0015,
      tags: {},
    } as never);
  }
  const mid = Math.floor(trackNodes.length / 2);
  const ways = [trackNodes.slice(0, mid + 1), trackNodes.slice(mid)].map(
    (chunk, i) => ({
      type: "way" as const,
      id: id(),
      nodes: (i === 0 ? chunk : [...chunk].reverse()).map((n) => n.id),
      tags: { railway: opts.railway ?? "light_rail" },
    }),
  );
  return {
    elements: [
      ...trackNodes,
      ...ways,
      {
        type: "relation",
        id: relationId,
        tags: { route: "light_rail", network: opts.network ?? "LRT Jakarta" },
        members: [
          ...nodes.map((n) => ({
            type: "node" as const,
            ref: n.id,
            role: "stop",
          })),
          ...ways.map((w) => ({ type: "way" as const, ref: w.id, role: "" })),
        ],
      },
    ],
  };
}

const lat = (i: number) => -6.2 - i * 0.004;
// Shared trunk: Dukuh Atas BNI, Setiabudi, Rasuna Said, Cawang. CB then forks
// to Taman Mini, BK to Halim. Naming rights suffixes must not matter.
const TRUNK = [
  "Dukuh Atas Bank Syariah Indonesia",
  "Setiabudi",
  "Rasuna Said",
  "Cawang",
];
const cbStations = [...TRUNK, "Taman Mini", "Harjamukti"].map(
  (name, i): Station => ({ name, lon: 106.82 + i * 0.002, lat: lat(i) }),
);
const bkStations = [...TRUNK, "Halim", "Jatimulya"].map((name, i): Station => ({
  name,
  lon: 106.82 + i * 0.002,
  lat: lat(i),
}));
const jStations = [
  "Manggarai",
  "Proklamasi",
  "Matraman",
  "Velodrome",
  "Kelapa Gading",
].map((name, i): Station => ({ name, lon: 106.9 + i * 0.002, lat: -6.18 }));

// Real relation ids, fixture-sized station lists (base names, outbound order).
const CONFIG: Record<"J" | "CB" | "BK", LrtLine> = {
  J: {
    ...LRT_LINES.J,
    stations: [
      "manggarai",
      "proklamasi",
      "matraman",
      "velodrome",
      "kelapa gading",
    ],
  },
  CB: {
    ...LRT_LINES.CB,
    stations: [
      "dukuh atas",
      "setiabudi",
      "rasuna said",
      "cawang",
      "taman mini",
      "harjamukti",
    ],
  },
  BK: {
    ...LRT_LINES.BK,
    stations: [
      "dukuh atas",
      "setiabudi",
      "rasuna said",
      "cawang",
      "halim",
      "jatimulya",
    ],
  },
};
// Bake one system: its documents (outbound, return per line) and its lines.
const ORDERS = { jakarta: ["J"], jabodebek: ["CB", "BK"] } as const;
// Mode comes from LRT_SYSTEMS, exactly as scripts/sync-lrt.ts passes it.
const bake = (system: keyof typeof ORDERS, d: OsmLrtDocument[]) =>
  bakeLrt(
    d,
    ORDERS[system].map((id) => CONFIG[id]),
    LRT_SYSTEMS[system].mode,
  );
const jakarta = (d: OsmLrtDocument[]) => bake("jakarta", d.slice(0, 2));
const jabodebek = (d: OsmLrtDocument[]) => bake("jabodebek", d.slice(2));

const rel = (line: keyof typeof LRT_LINES, dir: 0 | 1) =>
  LRT_LINES[line].relations[dir];
const reverse = (s: Station[]) => [...s].reverse();

function docs(
  options: { spur?: boolean; mutate?: (d: OsmLrtDocument[]) => void } = {},
) {
  const d: OsmLrtDocument[] = [
    build(rel("J", 0), jStations),
    build(rel("J", 1), reverse(jStations), { spur: options.spur }),
    build(rel("CB", 0), cbStations, {
      network: "Jabodebek LRT",
      skewMetres: 8,
    }),
    build(rel("CB", 1), reverse(cbStations), {
      network: "Jabodebek LRT",
      skewMetres: -8,
    }),
    build(rel("BK", 0), bkStations, {
      network: "Jabodebek LRT",
      skewMetres: 8,
    }),
    build(rel("BK", 1), reverse(bkStations), {
      network: "Jabodebek LRT",
      skewMetres: -8,
    }),
  ];
  options.mutate?.(d);
  return d;
}

test("the two LRT systems are separate modes owned by different operators", () => {
  // LRT Jakarta is the Jakarta government's (Jakpro); Jabodebek is PT KAI's.
  assert.deepEqual(LRT_SYSTEMS.jakarta.lines, ["J"]);
  assert.deepEqual(LRT_SYSTEMS.jabodebek.lines, ["CB", "BK"]);
  assert.equal(LRT_SYSTEMS.jakarta.mode, "lrt");
  assert.equal(LRT_SYSTEMS.jabodebek.mode, "lrtj");
  assert.notEqual(LRT_SYSTEMS.jakarta.dir, LRT_SYSTEMS.jabodebek.dir);
  // Each line belongs to exactly one system.
  const all = [...LRT_SYSTEMS.jakarta.lines, ...LRT_SYSTEMS.jabodebek.lines];
  assert.deepEqual([...all].sort(), Object.keys(LRT_LINES).sort());
});

test("each system bakes its own lines, two directions each, no invented timetable", () => {
  const j = jakarta(docs());
  const jb = jabodebek(docs());
  assert.deepEqual(
    j.routes.map((r) => r.route_id),
    ["J"],
  );
  assert.deepEqual(
    jb.routes.map((r) => r.route_id),
    ["CB", "BK"],
  );
  assert.deepEqual(
    jb.routes.map((r) => r.route_color),
    ["20409A", "0E6938"],
  );
  for (const detail of [...j.details, ...jb.details]) {
    assert.equal(detail.variants.length, 2);
    assert.deepEqual(
      detail.variants[1].stopIds,
      [...detail.variants[0].stopIds].reverse(),
    );
    assert.ok(
      detail.variants.every(
        (v) =>
          v.kind === "utama" &&
          v.headwaySecs === null &&
          v.windows.length === 0,
      ),
    );
  }
  const byId = Object.fromEntries(
    [...j.details, ...jb.details].map((d) => [d.route_id, d]),
  );
  assert.equal(byId.J.stops.length, 5);
  assert.equal(byId.CB.stops.length, 6);
  assert.equal(byId.BK.stops.length, 6);
  assert.deepEqual(
    byId.CB.stops.map((s) => s.stop_id),
    ["CB01", "CB02", "CB03", "CB04", "CB05", "CB06"],
  );
  assert.deepEqual(
    byId.J.variants.map((v) => v.headsign),
    ["Kelapa Gading", "Manggarai"],
  );
  assert.deepEqual(
    byId.BK.variants.map((v) => v.headsign),
    ["Jatimulya", "Dukuh Atas Bank Syariah Indonesia"],
  );
});

test("neither system's dataset contains the other's lines or stations", () => {
  const j = jakarta(docs());
  const jb = jabodebek(docs());
  assert.equal(j.stations.length, 5);
  assert.ok(
    j.stations.every((s) => s.routes.length === 1 && s.routes[0] === "J"),
  );
  assert.ok(!jb.stations.some((s) => s.routes.includes("J")));
  assert.ok(!jb.stations.some((s) => s.name === "Manggarai"));
  assert.ok(!j.stations.some((s) => s.name.startsWith("Dukuh Atas")));
  assert.ok(
    !j.overview.features.some((f) => f.properties?.color !== "#F16227"),
  );
  assert.ok(
    !jb.overview.features.some((f) => f.properties?.color === "#F16227"),
  );
});

test("stations shared by Cibubur and Bekasi merge into one station served by both", () => {
  const { stations } = jabodebek(docs());
  // 4 shared trunk + Taman Mini + Harjamukti + Halim + Jatimulya
  assert.equal(stations.length, 4 + 4);
  for (const name of ["Dukuh Atas", "Setiabudi", "Rasuna Said", "Cawang"]) {
    const hit = stations.filter((s) => s.name.startsWith(name));
    assert.equal(hit.length, 1, `${name} must be one station`);
    assert.deepEqual(hit[0].routes, ["BK", "CB"]);
    assert.deepEqual(Object.keys(hit[0].positions).sort(), ["BK", "CB"]);
  }
  assert.deepEqual(stations.find((s) => s.name === "Taman Mini")!.routes, [
    "CB",
  ]);
  assert.deepEqual(stations.find((s) => s.name === "Halim")!.routes, ["BK"]);
});

test("a merged station marker is centered between both lines' both directions", () => {
  const { stations, stopLayer } = jabodebek(docs());
  const cawang = stations.find((s) => s.name === "Cawang")!;
  // Fixture tracks are skewed +8 m / -8 m, so the centre is the unskewed lon.
  const expectedLon = 106.82 + 3 * 0.002;
  assert.ok(Math.abs(cawang.lon - expectedLon) < 0.00001, `lon ${cawang.lon}`);
  const feature = stopLayer.features.find(
    (f) => f.properties?.name === cawang.name,
  )!;
  assert.deepEqual(feature.geometry.coordinates, [cawang.lon, cawang.lat]);
});

test("terminal shapes end on the shared marker and drop the dead-end spur", () => {
  const { details, stations } = jakarta(docs({ spur: true }));
  const j = details.find((d) => d.route_id === "J")!;
  for (const v of j.variants) {
    const shape = j.geometryByShape[v.shape_id];
    const first = j.stops.find((s) => s.stop_id === v.stopIds[0])!;
    const last = j.stops.find((s) => s.stop_id === v.stopIds.at(-1))!;
    assert.deepEqual(shape[0], [first.stop_lon, first.stop_lat]);
    assert.deepEqual(shape.at(-1), [last.stop_lon, last.stop_lat]);
    // The spur is 0.0015 deg north of the terminal platform; nothing may reach it.
    assert.ok(
      shape.every((p) => p[1] <= -6.18 + 0.0001),
      "spur must be trimmed",
    );
  }
  assert.equal(stations.filter((s) => s.name === "Kelapa Gading").length, 1);
});

test("shared trunk shapes are identical between lines so the map can offset one", () => {
  const { details } = jabodebek(docs());
  const cb = details.find((d) => d.route_id === "CB")!;
  const bk = details.find((d) => d.route_id === "BK")!;
  const trunkEnd = cb.stops[3];
  const clip = (d: typeof cb) =>
    d.geometryByShape[d.variants[0].shape_id].filter(
      (p) => p[1] >= trunkEnd.stop_lat - 1e-6,
    );
  assert.deepEqual(clip(cb), clip(bk));
});

test("LRT rejects wrong network, unfinished track, missing ways and bad station counts", () => {
  assert.throws(
    () =>
      jabodebek(
        docs({
          mutate: (d) => {
            const r = d[2].elements.find((e) => e.type === "relation")!;
            if (r.type === "relation") r.tags = { ...r.tags, route: "bus" };
          },
        }),
      ),
    /not an operating light_rail route/,
  );
  assert.throws(
    () =>
      jabodebek(
        docs({
          mutate: (d) => {
            const w = d[3].elements.find((e) => e.type === "way")!;
            if (w.type === "way") w.tags = { railway: "construction" };
          },
        }),
      ),
    /not operating light_rail track/,
  );
  assert.throws(
    () =>
      jabodebek(
        docs({
          mutate: (d) => {
            d[4].elements = d[4].elements.filter((e) => e.type !== "way");
          },
        }),
      ),
    /missing track way/,
  );
  assert.throws(
    () =>
      jakarta(
        docs({
          mutate: (d) => {
            const r = d[0].elements.find((e) => e.type === "relation")!;
            if (r.type === "relation") r.members.splice(0, 1);
          },
        }),
      ),
    /expected 5 stations/,
  );
  // A Jabodebek relation fed to the Jakarta baker is the wrong network.
  assert.throws(
    () => bakeLrt(docs().slice(2, 4), [CONFIG.J], "lrt"),
    /not an operating light_rail route of LRT Jakarta/,
  );
  assert.throws(
    () => bake("jabodebek", docs().slice(2, 5)),
    /needs both directions of every line/,
  );
});

test("Jabodebek overview offsets the trunk lines; LRT Jakarta stays on its track", () => {
  const offsets = (
    overview: ReturnType<typeof bakeLrt>["overview"],
    colour: string,
  ) =>
    overview.features
      .filter((f) => f.properties?.color === colour)
      .map((f) => f.properties?.lineOffset);
  const { overview } = jabodebek(docs());
  const cb = offsets(overview, "#20409A");
  const bk = offsets(overview, "#0E6938");
  // Both directions of one line sit on the same physical side, so their
  // signs flip with direction; the two lines take opposite sides.
  assert.equal(cb.length, 2);
  assert.equal(bk.length, 2);
  assert.ok(cb.every((o) => typeof o === "number" && o !== 0));
  assert.ok(bk.every((o) => typeof o === "number" && o !== 0));
  assert.equal(cb[0], -cb[1]);
  assert.equal(bk[0], -bk[1]);
  assert.equal(cb[0], -bk[0]);
  // LRT Jakarta shares no track, so it must not be shifted.
  assert.deepEqual(offsets(jakarta(docs()).overview, "#F16227"), [
    undefined,
    undefined,
  ]);
});
