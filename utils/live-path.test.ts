import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  LIVE_PATH_MAX_DETOUR,
  headingBetween,
  metresBetween,
  pathHeading,
  samplePath,
  shapePath,
  type LngLat,
} from "./live-path";

/** Real baked geometry: the trunk shape of Transjakarta route 1. */
const shape: LngLat[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/gtfs/routes/1.json"), "utf8"),
).geometryByShape["1-R07_shp"];

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

/** Distance from a point to a polyline, for "is this still on the road" checks. */
const offShape = (point: LngLat, line: LngLat[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * kx;
    const py = (point[1] - a[1]) * 110_540;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(px - dx * t, py - dy * t));
  }
  return best;
};

test("a mid-route stretch follows the real shape, not the chord across a turn", () => {
  const from = shape[10];
  const to = shape[40];
  const driven = shapePath(shape, from, to);
  assert.ok(driven, "the shape explains this movement");
  assert.ok(driven.length > 0);

  // Every sampled pose sits on the road, including halfway, where a straight
  // line would cut the corner.
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(
      offShape(samplePath(driven, t), shape) <= 30,
      `sample ${t} left the shape`,
    );
  }
  const chordMid: LngLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  assert.ok(
    metresBetween(samplePath(driven, 0.5), chordMid) > 5,
    "this stretch has a turn, so the halfway point must differ from the chord",
  );
  // Ends are the observations, not the raw projection artefacts.
  assert.ok(metresBetween(samplePath(driven, 0), from) < 1);
  assert.ok(metresBetween(samplePath(driven, 1), to) < 1);
});

test("observations are trusted only near the shape", () => {
  const from = shape[20];
  const far: LngLat = [from[0] + 0.01, from[1]]; // ~1.1 km east
  assert.equal(shapePath(shape, far, shape[30]), null);
  assert.equal(shapePath(shape, from, far), null);
  // Just inside the tolerance still works.
  const nudged: LngLat = [from[0], from[1] + 0.0001]; // ~11 m north
  assert.ok(shapePath(shape, nudged, shape[30]));
});

test("backwards travel along the shape is refused so the opposite direction never mirrors", () => {
  assert.equal(shapePath(shape, shape[40], shape[10]), null);
  assert.equal(shapePath(shape, shape[100], shape[100]), null);
});

test("a detour around another branch is refused instead of followed", () => {
  const a: LngLat = [106.8, -6.2];
  // Out 500 m east, back west, ending 10 m north of the start: a U-turn.
  const fork: LngLat[] = [
    a,
    [106.8045, -6.2],
    [106.8045, -6.1999],
    [106.8, -6.1999],
    [106.8, a[1] + 0.00009],
  ];
  const straight = metresBetween(a, [106.8, a[1] + 0.00009]);
  const along = fork
    .slice(1)
    .reduce((sum, p, i) => sum + metresBetween(fork[i], p), 0);
  assert.ok(
    along > straight * LIVE_PATH_MAX_DETOUR,
    "fixture is a real detour",
  );
  assert.equal(shapePath(fork, a, [106.8, a[1] + 0.00009]), null);
});

test("missing or degenerate shapes fall back instead of throwing", () => {
  const p = shape[5];
  assert.equal(shapePath(null, p, shape[9]), null);
  assert.equal(shapePath([], p, shape[9]), null);
  assert.equal(shapePath([[106.8, -6.2]], p, shape[9]), null);
  assert.equal(shapePath(shape, p, p), null);
});

test("heading follows the road through a turn and ignores noise", () => {
  const corner: LngLat[] = [
    [106.8, -6.2], // north
    [106.8, -6.199], // turn
    [106.801, -6.199], // east
  ];
  const driven = shapePath(corner, corner[0], corner[2])!;
  assert.ok(driven);
  const start = pathHeading(driven, 0)!;
  const end = pathHeading(driven, 1)!;
  // North is 0, east is 90; the sampled heading must move between them.
  assert.ok(start < 20, `start ${start}`);
  assert.ok(end > 70, `end ${end}`);
  // A zero-length step has no heading at all, never a fake north.
  assert.equal(headingBetween([106.8, -6.2], [106.8, -6.2]), null);
  assert.equal(pathHeading({ points: [[106.8, -6.2]], length: 0 }, 0.5), null);
});

test("distance sampling is uniform along the path, not per vertex", () => {
  const line: LngLat[] = [
    [106.8, -6.2],
    [106.8, -6.19],
    [106.8, -6.1899], // dense vertices at the end
  ];
  const driven = shapePath(line, line[0], line[2])!;
  const quarter = samplePath(driven, 0.25);
  const half = samplePath(driven, 0.5);
  near(metresBetween(line[0], quarter), driven.length * 0.25, 0.5);
  near(metresBetween(line[0], half), driven.length * 0.5, 0.5);
});
