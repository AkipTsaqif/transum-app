import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { RouteDetail } from "@/utils/types/gtfs";
import { divergingRuns, trunkLines } from "./trunk-lines";

type Point = [number, number];

function metres(a: Point, b: Point): number {
    const lonScale = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180) * 111320;
    return Math.hypot((a[0] - b[0]) * lonScale, (a[1] - b[1]) * 110540);
}

function distanceToLines(point: Point, lines: Point[][]): number {
    let best = Infinity;
    for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            const xScale = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180) * 111320;
            const dx = (b[0] - a[0]) * xScale;
            const dy = (b[1] - a[1]) * 110540;
            const lengthSquared = dx * dx + dy * dy;
            const t = lengthSquared === 0
                ? 0
                : Math.max(0, Math.min(1, (((point[0] - a[0]) * xScale) * dx +
                      ((point[1] - a[1]) * 110540) * dy) / lengthSquared));
            best = Math.min(best, metres(point, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
        }
    }
    return best;
}

function loadRoute(id: string): RouteDetail {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "gtfs", "routes", `${id}.json`), "utf8")
    ) as RouteDetail;
}

test("shared trunk directions are drawn only once", () => {
    const first: Point[] = [[106.8, -6.2], [106.81, -6.2]];
    const reverse: Point[] = [[106.81, -6.2], [106.8, -6.2]];
    assert.deepEqual(divergingRuns(reverse, [first]), []);
});

test("a return street branching off and rejoining the trunk is retained", () => {
    const first: Point[] = [[106.8, -6.2], [106.81, -6.2]];
    const reverse: Point[] = [
        [106.81, -6.2], [106.8075, -6.1985], [106.8025, -6.1985], [106.8, -6.2],
    ];
    const runs = divergingRuns(reverse, [first]);
    assert.ok(runs.length > 0);
    assert.ok(distanceToLines([106.805, -6.1985], runs) < 25);
    assert.ok(runs.every((run) => run.length >= 2));
});

test("route 2 draws the return trip via Balai Kota, Gambir 2 and Kwitang", () => {
    const route = loadRoute("2");
    const first = route.geometryByShape["2-R05_shp"];
    const lines = trunkLines(route);
    assert.ok(lines.length > 1, "return streets should be added to the outbound line");
    assert.equal(lines[0], first, "keep the first trunk unchanged");

    for (const name of ["Balai Kota", "Gambir 2", "Kwitang"]) {
        const stop = route.stops.find((s) => s.stop_name === name);
        assert.ok(stop, `${name} exists in the feed`);
        const point: Point = [stop.stop_lon, stop.stop_lat];
        assert.ok(distanceToLines(point, [first]) > 200, `${name} was missing from the outbound line`);
        assert.ok(distanceToLines(point, lines) < 35, `${name} is near a drawn return stretch`);
    }
});

test("route 1 keeps shared streets out of the return line", () => {
    const route = loadRoute("1");
    const lines = trunkLines(route);
    const first = lines[0];
    assert.ok(lines.length > 1, "unique return streets remain visible");

    for (const run of lines.slice(1)) {
        // Runs join the main line at either end. On short runs those two join
        // samples are a large percentage; the *interior* is what must be new.
        const interior = run.slice(1, -1);
        const shared = interior.filter((point) => distanceToLines(point, [first]) <= 30).length;
        assert.ok(shared / Math.max(1, interior.length) < 0.2,
            "return stretch should not double-paint the trunk");
    }
});
