import assert from "node:assert/strict";
import test from "node:test";
import { LiveShapeRequests } from "./live-shape-requests";

test("failed shape is not fetched on each one-second snapshot", () => {
  const policy = new LiveShapeRequests(40, 30_000);
  assert.deepEqual(policy.select(["1"], 0), ["1"]);
  policy.failed("1", 0);
  assert.deepEqual(policy.select(["1"], 1000), []);
  assert.deepEqual(policy.select(["1"], 29_999), []);
  assert.deepEqual(policy.select(["1"], 30_000), ["1"]);
});
test("more visible routes than cache slots cannot evict and refetch in a loop", () => {
  const policy = new LiveShapeRequests(2);
  assert.deepEqual(policy.select(["a", "b", "c"], 0), ["a", "b"]);
  assert.deepEqual(policy.select(["c", "a", "b"], 1000), ["a", "b"]);
  assert.deepEqual(policy.select(["b", "c"], 2000), ["b", "c"]);
});
