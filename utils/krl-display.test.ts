import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    airportDisplayLine,
    airportManggaraiDisplayPoint,
    airportTerminalScreenPoint,
    manggaraiDisplayPlatforms,
} from "./krl-display";
import type { RouteDetail, StationIndexEntry } from "./types/gtfs";

const a = JSON.parse(readFileSync("data/krl/routes/A.json", "utf8")) as RouteDetail;
const stations = JSON.parse(readFileSync("data/krl/stops.json", "utf8")) as StationIndexEntry[];
const duri = a.stops.find((s) => s.stop_name === "Duri")!;
const manggarai = stations.find((s) => s.name === "Manggarai")!;
const point = airportManggaraiDisplayPoint(manggarai.anchors!)!;
const meters = (x: [number, number], y: [number, number]) =>
    Math.hypot((x[0] - y[0]) * 110_700, (x[1] - y[1]) * 110_540);

test("the Manggarai airport pip lies directly between Bogor and Cikarang", () => {
    const b = manggarai.anchors!.find((anchor) => anchor.routeId === "B")!;
    const c = manggarai.anchors!.find((anchor) => anchor.routeId === "C")!;
    assert.deepEqual(point, [(b.lon + c.lon) / 2, (b.lat + c.lat) / 2]);
    assert.ok(meters(point, [a.stops[0].stop_lon, a.stops[0].stop_lat]) > 100,
        "display position must not overwrite the physical airport platform");
    for (const z of [1, 6, 18]) {
        const scaled = manggaraiDisplayPlatforms([[2, 0], [0, 0], [1, 0]], ["C", "B", "A"], z);
        assert.deepEqual(scaled, [[1 + z, 0], [1 - z, 0], [1, 0]]);
    }
});

test("both airport route directions stop each side at the Duri pip", () => {
    for (const v of a.variants) {
        const actual = a.geometryByShape[v.shape_id];
        const parts = airportDisplayLine(actual, [duri.stop_lon, duri.stop_lat], point);
        assert.equal(parts.length, 2);
        assert.deepEqual(parts[0].at(-1), [duri.stop_lon, duri.stop_lat]);
        assert.deepEqual(parts[1][0], [duri.stop_lon, duri.stop_lat]);
        const manggaraiEnd = v.stopIds[0] === "A01" ? parts[0][0] : parts[1].at(-1);
        assert.deepEqual(manggaraiEnd, point);
        // The northern hairpin (~77m past Duri) no longer appears. Other
        // northern vertices near the airport are unrelated to that turn.
        assert.ok(parts.every((p) => !p.some((coord) =>
            meters(coord, [duri.stop_lon, duri.stop_lat]) < 100 && coord[1] > -6.1548
        )));
        assert.deepEqual(actual[0], a.geometryByShape[v.shape_id][0],
            "the saved route shape must stay geographic");
        const alreadySplit = airportDisplayLine(parts[0], [duri.stop_lon, duri.stop_lat], point);
        assert.equal(alreadySplit.length, 1, "baked overview segments must not be split a second time");
        assert.deepEqual(alreadySplit[0].at(-1), [duri.stop_lon, duri.stop_lat]);
    }
});

test("airport terminal dot follows the offset line in screen pixels", () => {
    assert.deepEqual(airportTerminalScreenPoint([0, 0], [10, 0], 4), [10, 4]);
    assert.deepEqual(airportTerminalScreenPoint([10, 0], [0, 0], -4), [0, 4]);
});
