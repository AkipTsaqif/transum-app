import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLiveEnv } from "./env";

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "live-env-"));
const KEYS = ["TJ_LIVE_ENABLED", "TJ_LIVE_ALLOWED_ORIGIN", "TJ_LIVE_PORT"];
const reset = () => KEYS.forEach((k) => delete process.env[k]);

test("the sidecar picks up TJ_* settings from .env.local", () => {
  reset();
  const root = scratch();
  fs.writeFileSync(
    path.join(root, ".env.local"),
    "TJ_LIVE_ENABLED=true\nTJ_LIVE_ALLOWED_ORIGIN=http://localhost:3000\n",
  );
  assert.deepEqual(loadLiveEnv(root), [".env.local"]);
  assert.equal(process.env.TJ_LIVE_ENABLED, "true");
  assert.equal(process.env.TJ_LIVE_ALLOWED_ORIGIN, "http://localhost:3000");
  reset();
});

test("a value set in the shell always wins over the file", () => {
  reset();
  const root = scratch();
  fs.writeFileSync(path.join(root, ".env.local"), "TJ_LIVE_ENABLED=true\n");
  process.env.TJ_LIVE_ENABLED = "false";
  loadLiveEnv(root);
  assert.equal(process.env.TJ_LIVE_ENABLED, "false");
  reset();
});

test(".env.local takes priority over .env", () => {
  reset();
  const root = scratch();
  fs.writeFileSync(path.join(root, ".env.local"), "TJ_LIVE_PORT=9001\n");
  fs.writeFileSync(
    path.join(root, ".env"),
    "TJ_LIVE_PORT=9002\nTJ_LIVE_ENABLED=true\n",
  );
  assert.deepEqual(loadLiveEnv(root), [".env.local", ".env"]);
  assert.equal(process.env.TJ_LIVE_PORT, "9001");
  assert.equal(process.env.TJ_LIVE_ENABLED, "true");
  reset();
});

test("missing env files are not an error", () => {
  reset();
  assert.deepEqual(loadLiveEnv(scratch()), []);
  assert.equal(process.env.TJ_LIVE_ENABLED, undefined);
});
