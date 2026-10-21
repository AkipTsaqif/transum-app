import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import { interchangeFeatures, interchangesFromStops, projectedInterchangeEndpoints } from "./interchange";

const stops = JSON.parse(readFileSync("data/krl/stops-geo.json", "utf8")) as FeatureCollection;

test("one shared station yields two distinct physical endpoints and one label", () => {
    const groups = interchangesFromStops(stops);
    assert.deepEqual(groups.map((g) => g.name).sort(), [
        "BNI City", "Batu Ceper", "Duri", "Jakarta Kota",
        "Kampung Bandan", "Manggarai", "Rawa Buaya",
    ]);
    const group = groups.find((candidate) => candidate.name === "Kampung Bandan")!;
    const { pills, labels, endpoints } = interchangeFeatures([group]);
    assert.equal(pills.features.length, 1);
    assert.equal(labels.features.length, 1);
    assert.equal(endpoints.features.length, 2);
    assert.deepEqual(endpoints.features.map((f) => f.properties?.routeId), ["TP", "C"]);
    assert.deepEqual(pills.features[0].geometry.coordinates, endpoints.features.map((f) => f.geometry.coordinates));
    assert.equal(labels.features[0].properties?.name, "Kampung Bandan");
    const [tp, c] = endpoints.features.map((f) => f.geometry.coordinates);
    const distance = Math.hypot((tp[0] - c[0]) * 110_700, (tp[1] - c[1]) * 110_540);
    assert.ok(distance > 45 && distance < 60, `platforms are ${distance.toFixed(1)}m apart`);
});

test("three platforms share one label and connect via two branches", () => {
    const groups = interchangesFromStops(stops);
    const group = groups.find((candidate) => candidate.name === "Kampung Bandan")!;
    const extended = [{ ...group, anchors: [
        ...group.anchors,
        { routeId: "X", stopId: "X01", lat: -6.1326, lon: 106.8288, color: "#123456" },
    ] }];
    const { pills, labels, endpoints } = interchangeFeatures(extended);
    assert.equal(pills.features.length, 2);
    assert.equal(labels.features.length, 1);
    assert.equal(endpoints.features.length, 3);
    for (const segment of pills.features) {
        assert.equal(segment.geometry.coordinates.length, 2);
        assert.equal(segment.properties?.stationId, group.id);
    }
});

test("far-out stations display two distinguishable endpoints on every zoom", () => {
    assert.deepEqual(projectedInterchangeEndpoints([[10, 30], [10, 31]]), [[10, 17.5], [10, 43.5]]);
    assert.deepEqual(projectedInterchangeEndpoints([[10, 30], [10, 74]]), [[10, 30], [10, 74]]);
    const diagonal = projectedInterchangeEndpoints([[0, 0], [3, 4]]);
    assert.ok(Math.abs(Math.hypot(diagonal[1][0] - diagonal[0][0], diagonal[1][1] - diagonal[0][1]) - 26) < 0.01);
});

test("ordinary stops do not grow interchange markers", () => {
    const ordinary = { ...stops, features: stops.features.filter((f) =>
        !["Jakarta Kota", "Kampung Bandan", "Duri", "Manggarai", "BNI City", "Rawa Buaya", "Batu Ceper"].includes(String(f.properties?.name))
    ) };
    assert.deepEqual(interchangesFromStops(ordinary), []);
    assert.deepEqual(interchangesFromStops(null), []);
});
