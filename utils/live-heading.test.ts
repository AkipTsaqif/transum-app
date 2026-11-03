import assert from "node:assert/strict";
import test from "node:test";
import {
  ARROW_GAP,
  ARROW_HEIGHT,
  BADGE_HEIGHT,
  arrowOffset,
  badgeWidth,
  edgeDistance,
  screenHeading,
} from "./live-heading";

const clearance = ARROW_GAP + ARROW_HEIGHT / 2;

test("the arrow clears a wide box by the same gap in every direction", () => {
  const width = 60;
  // Heading north the nearest edge is the top, heading east it is the side.
  assert.equal(edgeDistance(width, BADGE_HEIGHT, 0), BADGE_HEIGHT / 2);
  assert.equal(edgeDistance(width, BADGE_HEIGHT, 180), BADGE_HEIGHT / 2);
  assert.equal(edgeDistance(width, BADGE_HEIGHT, 90), width / 2);
  assert.equal(edgeDistance(width, BADGE_HEIGHT, 270), width / 2);
  // A fixed orbit would put the north arrow at the east arrow's distance.
  assert.ok(arrowOffset(width, 0)[1] > arrowOffset(width, 90)[1]);
  assert.equal(arrowOffset(width, 0)[1], -(BADGE_HEIGHT / 2 + clearance));
});

test("the offset is straight along the icon's own axis, never sideways", () => {
  for (const angle of [0, 17, 45, 90, 133, 180, 271, 359]) {
    assert.equal(arrowOffset(32, angle)[0], 0);
    assert.ok(arrowOffset(32, angle)[1] < 0);
  }
});

test("a diagonal heading leaves through the corner region, not the far side", () => {
  const width = 40;
  const d = edgeDistance(width, BADGE_HEIGHT, 45);
  // 45 degrees on a 40x18 box exits through the top edge (9 / cos45).
  assert.ok(Math.abs(d - BADGE_HEIGHT / 2 / Math.cos(Math.PI / 4)) < 1e-9);
  assert.ok(d > BADGE_HEIGHT / 2 && d < width / 2);
});

test("a square box gives one distance per axis and a longer diagonal", () => {
  assert.equal(edgeDistance(20, 20, 0), 10);
  assert.equal(edgeDistance(20, 20, 90), 10);
  assert.ok(edgeDistance(20, 20, 45) > 10);
});

test("map rotation turns every heading with it", () => {
  assert.equal(screenHeading(90, 0), 90);
  assert.equal(screenHeading(90, 90), 0);
  assert.equal(screenHeading(10, 350), 20);
  assert.equal(screenHeading(0, 90), 270);
  assert.equal(screenHeading(359.5, 0), 359.5);
});

test("badge width has a floor and grows with the label", () => {
  assert.equal(badgeWidth(4), 24);
  assert.equal(badgeWidth(30), 42);
  assert.ok(badgeWidth(41.2) > badgeWidth(20));
});
