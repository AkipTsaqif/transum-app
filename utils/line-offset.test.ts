import assert from "node:assert/strict";
import test from "node:test";
import { AIRPORT_LINE_OFFSET_PX, airportLineOffset } from "./krl-line-offset";
import { LRT_TRUNK_OFFSET_PX, railLineOffset } from "./line-offset";

const east: [number, number][] = [
  [106.82, -6.2],
  [106.9, -6.25],
];
const west: [number, number][] = [...east].reverse();

test("opposite directions of an offset line land on the same physical side", () => {
  for (const [mode, id] of [
    ["krl", "A"],
    ["lrtj", "CB"],
    ["lrtj", "BK"],
  ] as const) {
    assert.equal(
      railLineOffset(mode, id, east),
      -railLineOffset(mode, id, west),
      `${mode}/${id} must flip sign with travel direction`,
    );
    assert.notEqual(railLineOffset(mode, id, east), 0);
  }
});

test("Cibubur and Bekasi split to opposite sides of the shared trunk", () => {
  assert.equal(
    railLineOffset("lrtj", "CB", east),
    -railLineOffset("lrtj", "BK", east),
  );
  assert.equal(
    Math.abs(railLineOffset("lrtj", "CB", east)),
    LRT_TRUNK_OFFSET_PX,
  );
  // 3px lines whose centres are 2 * offset apart must not overlap.
  assert.ok(
    2 * LRT_TRUNK_OFFSET_PX >= 4,
    "offset lines would still hide each other",
  );
});

test("lines that need no offset, other modes and degenerate shapes are untouched", () => {
  assert.equal(railLineOffset("lrt", "J", east), 0);
  assert.equal(railLineOffset("lrtj", "J", east), 0);
  assert.equal(
    railLineOffset("lrt", "CB", east),
    0,
    "the trunk offset belongs to LRT Jabodebek, not LRT Jakarta",
  );
  assert.equal(railLineOffset("mrt", "M", east), 0);
  assert.equal(
    railLineOffset("gtfs", "CB", east),
    0,
    "a bus route id must never inherit an LRT offset",
  );
  assert.equal(
    railLineOffset("krl", "CB", east),
    0,
    "route ids are scoped to their mode",
  );
  assert.equal(railLineOffset("lrt", "A", east), 0);
  assert.equal(railLineOffset("lrtj", "CB", []), 0);
  assert.equal(railLineOffset("lrtj", "CB", [[106.8, -6.2]]), 0);
});

test("the KRL airport offset is unchanged by the generalisation", () => {
  assert.equal(railLineOffset("krl", "A", east), airportLineOffset("A", east));
  assert.equal(railLineOffset("krl", "A", west), airportLineOffset("A", west));
  assert.equal(
    Math.abs(railLineOffset("krl", "A", east)),
    AIRPORT_LINE_OFFSET_PX,
  );
});
