import assert from "node:assert/strict";
import test from "node:test";
import { liveConfig } from "./config";

const base = {
  TJ_LIVE_ENABLED: "true",
  TJ_LIVE_ALLOWED_ORIGIN: "https://app.example",
};

test("a valid production setting parses host, port and origin", () => {
  assert.deepEqual(
    liveConfig({ ...base, TJ_LIVE_HOST: "0.0.0.0", TJ_LIVE_PORT: "8787" }),
    {
      enabled: true,
      allowedOrigin: "https://app.example",
      host: "0.0.0.0",
      port: 8787,
    },
  );
});

test("an enabled sidecar refuses a missing or blank origin instead of allowing every site", () => {
  for (const origin of [undefined, "", "   "]) {
    assert.throws(
      () =>
        liveConfig({ TJ_LIVE_ENABLED: "true", TJ_LIVE_ALLOWED_ORIGIN: origin }),
      /TJ_LIVE_ALLOWED_ORIGIN is required/,
    );
  }
});

test("a disabled sidecar may omit the origin", () => {
  assert.equal(
    liveConfig({ TJ_LIVE_ENABLED: "false" }).allowedOrigin,
    undefined,
  );
});

test('only the literal "true" enables it', () => {
  for (const value of ["TRUE", "1", "yes", "on", undefined]) {
    assert.equal(
      liveConfig({ TJ_LIVE_ENABLED: value }).enabled,
      false,
      String(value),
    );
  }
});

test("origins that could never match a browser Origin header are rejected with the fix", () => {
  for (const origin of [
    "https://app.example/",
    "https://app.example/live",
    "https://app.example?x=1",
    "app.example",
    "ftp://app.example",
  ]) {
    assert.throws(
      () => liveConfig({ ...base, TJ_LIVE_ALLOWED_ORIGIN: origin }),
      /TJ_LIVE_ALLOWED_ORIGIN/,
      origin,
    );
  }
  // The suggestion shows the corrected value.
  assert.throws(
    () =>
      liveConfig({ ...base, TJ_LIVE_ALLOWED_ORIGIN: "https://app.example/" }),
    /use "https:\/\/app\.example"/,
  );
});

test("http and localhost with a port stay valid", () => {
  for (const origin of [
    "http://localhost:3000",
    "https://127.0.0.1:8443",
    "https://app.example:8443",
  ]) {
    assert.equal(
      liveConfig({ ...base, TJ_LIVE_ALLOWED_ORIGIN: origin }).allowedOrigin,
      origin,
    );
  }
});

test("an invalid port is rejected rather than silently defaulted", () => {
  for (const port of ["0", "70000", "abc", "8787.5"]) {
    assert.throws(
      () => liveConfig({ ...base, TJ_LIVE_PORT: port }),
      /Invalid TJ_LIVE_PORT/,
      port,
    );
  }
});

test("host defaults to loopback so a bare process is never exposed", () => {
  assert.equal(liveConfig(base).host, "127.0.0.1");
  assert.equal(liveConfig({ ...base, TJ_LIVE_HOST: "   " }).host, "127.0.0.1");
});
