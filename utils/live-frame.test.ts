import assert from "node:assert/strict";
import test from "node:test";
import {
  liveFeatureDiff,
  livePoseKey,
  LIVE_FRAME_MS,
  nextLivePaint,
} from "./live-frame";

test("frame writes use the geometry and property edit contract MapLibre applies", () => {
  const f = {
    type: "Feature" as const,
    id: "bus",
    properties: { heading: 90, arrow: null },
    geometry: { type: "Point" as const, coordinates: [106.80000001, -6.2] },
  };
  const diff = liveFeatureDiff(f);
  assert.equal(diff.id, "bus");
  assert.deepEqual(diff.newGeometry, f.geometry);
  assert.deepEqual(diff.addOrUpdateProperties, [
    { key: "heading", value: 90 },
    { key: "arrow", value: null },
  ]);
  assert.equal(
    "geometry" in diff,
    false,
    "full Features in update are ignored by the worker",
  );
});
test("a high-refresh display retains the frame remainder instead of collapsing to 48 fps", () => {
  let previous = -Infinity,
    paints = 0;
  for (let frame = 0; frame < 144; frame++) {
    const now = (frame * 1000) / 144;
    if (now - previous >= LIVE_FRAME_MS - 0.5) {
      previous = nextLivePaint(now, previous);
      paints++;
    }
  }
  assert.ok(paints >= 58 && paints <= 62, `${paints} paints/second`);
});
test("subpixel coordinates are not rounded out of motion and target cadence is 60 fps", () => {
  assert.notEqual(
    livePoseKey(-6.2, 106.8, null),
    livePoseKey(-6.2, 106.80000001, null),
  );
  assert.equal(LIVE_FRAME_MS, 1000 / 60);
});
