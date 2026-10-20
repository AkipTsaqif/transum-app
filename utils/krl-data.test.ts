import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RouteDetail, StationIndexEntry } from "./types/gtfs";

const load = <T>(name: string): T =>
    JSON.parse(readFileSync(`data/krl/${name}`, "utf8")) as T;

const c = load<RouteDetail>("routes/C.json");
const tp = load<RouteDetail>("routes/TP.json");
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
    assert.equal(overview.features.length, 3); // TP + both C rackets
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
});

test("TP directionality and shared interchange remain intact", () => {
    assert.deepEqual(tp.variants[0].stopIds, ["TP01", "TP02", "TP03", "TP05"]);
    assert.deepEqual(tp.variants[1].stopIds, ["TP05", "TP04", "TP03", "TP02", "TP01"]);
    assert.equal(stations.length, 30);
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
