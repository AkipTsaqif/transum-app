import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AIRPORT_LINE_OFFSET_PX, airportLineOffset } from "./krl-line-offset";

const airport = JSON.parse(readFileSync("data/krl/routes/A.json", "utf8"));
const overview = JSON.parse(readFileSync("data/krl/overview.json", "utf8"));

test("only airport routes get an offset; opposite directions share the same displayed side", () => {
    const [outbound, inbound] = airport.variants.map(
        (variant: { shape_id: string }) => airport.geometryByShape[variant.shape_id]
    ) as [number, number][][];
    assert.equal(airportLineOffset("A", outbound), AIRPORT_LINE_OFFSET_PX);
    assert.equal(airportLineOffset("A", inbound), -AIRPORT_LINE_OFFSET_PX);
    assert.equal(airportLineOffset("C", outbound), 0);
    assert.equal(airportLineOffset("T", inbound), 0);
    assert.equal(airportLineOffset("A", []), 0);
});

test("baked airport overview uses the offset, and other lines keep their physical geometry", () => {
    const airportFeature = overview.features.filter(
        (feature: { properties: { color: string } }) => feature.properties.color === "#2E2F70"
    );
    assert.equal(airportFeature.length, 2);
    assert.ok(airportFeature.every((feature: { properties: { lineOffset: number } }) =>
        feature.properties.lineOffset === AIRPORT_LINE_OFFSET_PX));
    assert.ok(overview.features.filter(
        (feature: { properties: { color: string; lineOffset?: number } }) =>
            feature.properties.color !== "#2E2F70" && feature.properties.lineOffset !== undefined
    ).length === 0);
    const duri = airport.stops.find((stop: { stop_name: string }) => stop.stop_name === "Duri");
    assert.deepEqual(airportFeature[0].geometry.coordinates.at(-1), [duri.stop_lon, duri.stop_lat]);
    assert.deepEqual(airportFeature[1].geometry.coordinates[0], [duri.stop_lon, duri.stop_lat]);
    assert.deepEqual(airportFeature[1].geometry.coordinates.at(-1),
        airport.geometryByShape[airport.variants[0].shape_id].at(-1));
});
