import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RouteDetail, StationIndexEntry } from "./types/gtfs";

const load = <T>(name: string): T =>
    JSON.parse(readFileSync(`data/krl/${name}`, "utf8")) as T;

const c = load<RouteDetail>("routes/C.json");
const tp = load<RouteDetail>("routes/TP.json");
const t = load<RouteDetail>("routes/T.json");
const b = load<RouteDetail>("routes/B.json");
const namboshapeEnd = (shape: [number, number][]) => shape.at(-1)!;
const stations = load<StationIndexEntry[]>("stops.json");
const overview = load<{
    features: {
        properties: { color: string; opacity: number; width: number };
        geometry: { coordinates: [number, number][] };
    }[];
}>("overview.json");

test("C full rackets retain ordered repeated calls and one-way Pasar Senen", () => {
    assert.deepEqual(c.variants.map((v) => v.stopCount), [38, 37]);
    assert.equal(c.stops.length, 26);
    assert.equal(new Set(c.stops.map((s) => s.stop_id)).size, 26);
    const all = new Set(c.stops.map((s) => s.stop_id));
    for (const variant of c.variants) {
        assert.equal(variant.kind, "utama");
        assert.equal(variant.stopIds[0], "C26");
        assert.equal(variant.stopIds.at(-1), "C26");
        assert.equal(variant.stopIds.filter((id) => id === "C15").length, 2);
        assert.ok(variant.stopIds.every((id) => all.has(id)));
        assert.equal(variant.headwaySecs, null);
        assert.deepEqual(variant.windows, []);
    }
    assert.equal(c.variants[0].stopIds.includes("C04"), true);
    assert.equal(c.variants[1].stopIds.includes("C04"), false);
    assert.equal(c.route_color, "26BAED");
});

test("C overview includes both continuous racket shapes", () => {
    const meters = (a: [number, number], b: [number, number]) =>
        Math.hypot((a[0] - b[0]) * 110_700, (a[1] - b[1]) * 110_540);
    assert.equal(overview.features.length, 6); // TP + both C rackets + T + B main/branch
    for (const v of c.variants) {
        const shape = c.geometryByShape[v.shape_id];
        assert.ok(shape.length > 1000);
        // OSM way vertices can be hundreds of metres apart along a straight
        // track. A broken join is much larger than the longest ~0.8 km span.
        for (let i = 1; i < shape.length; i++) {
            assert.ok(meters(shape[i - 1], shape[i]) < 1_000, `${v.shape_id} jumped at ${i}`);
        }
    }
    for (const feature of overview.features) {
        assert.equal(feature.properties.opacity, 1);
        assert.equal(feature.properties.width, 3);
    }
    // One shared Cikarang terminal: a racket loops back to the same station,
    // so both overview ends must sit on that station instead of a buffer stop.
    const cikarang = c.stops.find((stop) => stop.stop_id === "C26")!;
    const cikarangOverview = overview.features.filter(
        (feature) => feature.properties.color === "#26BAED"
    );
    assert.equal(cikarangOverview.length, 2);
    for (const feature of cikarangOverview) {
        const ends = [feature.geometry.coordinates[0], feature.geometry.coordinates.at(-1)!];
        for (const end of ends) {
            assert.ok(
                meters(end, [cikarang.stop_lon, cikarang.stop_lat]) < 1,
                "Cikarang overview line must end on its station"
            );
        }
    }
});

test("TP directionality and shared interchange remain intact", () => {
    assert.deepEqual(tp.variants[0].stopIds, ["TP01", "TP02", "TP03", "TP05"]);
    assert.deepEqual(tp.variants[1].stopIds, ["TP05", "TP04", "TP03", "TP02", "TP01"]);
    assert.equal(stations.length, 64);
    assert.equal(stations.filter((s) => s.routes.includes("C")).length, 26);
    const shared = stations.filter((s) => s.name === "Kampung Bandan");
    assert.equal(shared.length, 1);
    assert.deepEqual(shared[0].routes, ["C", "TP"]);
    const tpStop = tp.stops.find((s) => s.stop_id === "TP02")!;
    assert.equal(shared[0].lat, tpStop.stop_lat);
    assert.equal(shared[0].lon, tpStop.stop_lon);
    assert.deepEqual(shared[0].anchors?.map((anchor) => anchor.routeId), ["TP", "C"]);
    const cStop = c.stops.find((s) => s.stop_id === "C07")!;
    assert.deepEqual(shared[0].anchors?.map((anchor) => [anchor.stopId, anchor.lat, anchor.lon]), [
        ["TP02", tpStop.stop_lat, tpStop.stop_lon],
        ["C07", cStop.stop_lat, cStop.stop_lon],
    ]);
});

test("Tangerang has eleven ordered stations each way and a shared Duri interchange", () => {
    assert.equal(t.route_id, "T");
    assert.equal(t.route_color, "C25F28");
    assert.deepEqual(t.stops.map((s) => s.stop_id),
        Array.from({ length: 11 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(t.variants.map((v) => v.stopIds), [
        t.stops.map((s) => s.stop_id),
        t.stops.map((s) => s.stop_id).reverse(),
    ]);
    for (const v of t.variants) {
        assert.equal(v.headwaySecs, null);
        assert.deepEqual(v.windows, []);
        assert.ok(t.geometryByShape[v.shape_id]?.length > 100);
    }
    const duri = stations.filter((s) => s.name === "Duri");
    assert.equal(duri.length, 1);
    assert.deepEqual(duri[0].routes, ["C", "T"]);
    assert.deepEqual(duri[0].anchors?.map((anchor) => anchor.routeId), ["C", "T"]);
    assert.deepEqual(duri[0].anchors?.map((anchor) => anchor.stopId), ["C09", "T01"]);
    assert.equal(stations.filter((s) => s.routes.includes("T")).length, 11);
    assert.equal(overview.features.filter((f) => f.properties.color === "#C25F28").length, 1);
});

test("Bogor and Nambo branch reach their southern terminals", () => {
    assert.equal(b.route_color, "EC2329");
    assert.equal(b.stops.length, 26);
    assert.deepEqual(b.variants.map((v) => v.stopCount), [24, 24, 23, 23]);
    assert.deepEqual(b.variants.map((v) => v.kind), ["utama", "utama", "alihan", "alihan"]);
    assert.deepEqual(b.variants.map((v) => [v.stopIds[0], v.stopIds.at(-1)]), [
        ["B01", "B26"], ["B26", "B01"], ["B01", "b04"], ["b04", "B01"],
    ]);
    const bogor = b.stops.find((stop) => stop.stop_name === "Bogor")!;
    assert.ok(bogor.stop_lat < -6.58, "Bogor must be south of the initial Jakarta view");
    const nambo = b.stops.find((stop) => stop.stop_name === "Nambo")!;
    const namboShape = b.geometryByShape[b.variants[2].shape_id];
    assert.ok(nambo.stop_lon > 106.9, "Nambo must remain on the eastern branch");
    assert.ok(
        Math.hypot((namboshapeEnd(namboShape)[0] - nambo.stop_lon) * 110_700,
            (namboshapeEnd(namboShape)[1] - nambo.stop_lat) * 110_540) < 1,
        "Nambo marker must sit at the branch endpoint"
    );
    assert.equal(overview.features.filter((f) => f.properties.color === "#EC2329").length, 2);
    const bounds = overview.features.flatMap((f) => f.geometry.coordinates);
    assert.ok(Math.min(...bounds.map((point) => point[1])) < bogor.stop_lat + 0.001);
    assert.deepEqual(stations.find((s) => s.name === "Jakarta Kota")?.routes, ["B", "TP"]);
    assert.deepEqual(stations.find((s) => s.name === "Manggarai")?.routes, ["B", "C"]);
});
