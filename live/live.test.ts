import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { LiveHub, type TransportEvents } from "./hub";
import { createLiveServer } from "./http";

const routes = new Map([
  ["1", "1"],
  ["2", "2"],
]);
const payload = {
  bus_body_no: "TEST",
  route_code: "1",
  latitude: -6.2,
  longitude: 106.8,
  timestamp: 1_800_000_000_000,
};

test("two viewers share one transport, routes stay filtered, last disconnect releases upstream", async () => {
  let starts = 0,
    stops = 0;
  let events!: TransportEvents;
  const hub = new LiveHub(
    routes,
    (e) => {
      starts++;
      events = e;
      return {
        stop() {
          stops++;
        },
      };
    },
    { idleMs: 1, now: () => payload.timestamp },
  );
  const a = hub.acquire(),
    b = hub.acquire();
  assert.equal(starts, 1);
  assert.equal(hub.snapshot("1").status, "connecting");
  events.ready();
  events.message(payload, false);
  assert.equal(hub.snapshot("1").vehicles.length, 1);
  assert.equal(hub.snapshot("2").vehicles.length, 0);
  a();
  a();
  assert.equal(hub.clientCount, 1);
  b();
  await sleep(10);
  assert.equal(stops, 1);
  assert.equal(hub.snapshot("1").vehicles.length, 0);
});
test("obsolete transport callbacks cannot make a reconnecting stream appear live", async () => {
  const events: TransportEvents[] = [];
  const hub = new LiveHub(
    routes,
    (e) => {
      events.push(e);
      return { stop() {} };
    },
    { retryMs: 1, random: () => 0 },
  );
  const release = hub.acquire();
  events[0].failed();
  assert.equal(hub.snapshot("1").status, "reconnecting");
  events[0].ready();
  assert.equal(hub.snapshot("1").status, "reconnecting");
  await sleep(10);
  assert.equal(events.length, 2);
  events[1].ready();
  assert.equal(hub.snapshot("1").status, "live");
  release();
  hub.stop();
});
test("HTTP SSE rejects missing routes, supplies filtered snapshots and heartbeat, and cleans up", async () => {
  const hub = new LiveHub(
    routes,
    (e) => {
      queueMicrotask(() => {
        e.ready();
        e.message(payload, false);
      });
      return { stop() {} };
    },
    { idleMs: 1, now: () => payload.timestamp },
  );
  const server = createLiveServer(hub, {
    enabled: true,
    allowedOrigin: "http://localhost:3000",
    intervalMs: 10,
    heartbeatMs: 10,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const ctrl = new AbortController();
  try {
    assert.equal((await fetch(`${base}/live/vehicles`)).status, 400);
    assert.equal(
      (await fetch(`${base}/live/vehicles?route=unknown`)).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/live/vehicles?route=1`, {
          headers: { Origin: "http://wrong" },
        })
      ).status,
      403,
    );
    const res = await fetch(`${base}/live/vehicles?route=1`, {
      signal: ctrl.signal,
    });
    assert.equal(
      res.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-accel-buffering"), "no");
    const reader = res.body!.getReader();
    let text = "";
    for (
      let i = 0;
      i < 20 && !(text.includes('"id":"TEST"') && text.includes(": heartbeat"));
      i++
    ) {
      const chunk = await reader.read();
      text += new TextDecoder().decode(chunk.value);
    }
    assert.match(text, /event: snapshot/);
    assert.match(text, /"id":"TEST"/);
    assert.match(text, /: heartbeat/);
    ctrl.abort();
    await sleep(20);
    assert.equal(hub.clientCount, 0);
  } finally {
    ctrl.abort();
    hub.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("HTTP viewport subscription streams several routes without leaking vehicles outside its bounds", async () => {
  const hub = new LiveHub(
    routes,
    (e) => {
      queueMicrotask(() => {
        e.ready();
        e.message(payload, false);
        e.message(
          { ...payload, bus_body_no: "ROUTE2", route_code: "2" },
          false,
        );
        e.message(
          { ...payload, bus_body_no: "OUTSIDE", latitude: -6.7 },
          false,
        );
      });
      return { stop() {} };
    },
    { idleMs: 1, now: () => payload.timestamp },
  );
  const server = createLiveServer(hub, { enabled: true, intervalMs: 5 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ctrl = new AbortController();
  try {
    for (const query of [
      "bbox=bad",
      "bbox=106,-5,107,-6",
      "route=1&bbox=106,-7,107,-6",
      "bbox=106,-7,107,-6&bbox=106,-7,107,-6",
    ]) {
      assert.equal((await fetch(`${base}/live/vehicles?${query}`)).status, 400);
    }
    const response = await fetch(
      `${base}/live/vehicles?bbox=106.7,-6.3,106.9,-6.1`,
      { signal: ctrl.signal },
    );
    const reader = response.body!.getReader();
    let text = "";
    for (let i = 0; i < 15 && !text.includes('"id":"ROUTE2"'); i++)
      text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /"routeId":null/);
    assert.match(text, /"id":"TEST"/);
    assert.match(text, /"id":"ROUTE2"/);
    assert.doesNotMatch(text, /OUTSIDE/);
    assert.equal(hub.clientCount, 1);
  } finally {
    ctrl.abort();
    hub.stop();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("throwing connectors back off rather than escaping HTTP request handling", async () => {
  let attempts = 0;
  const hub = new LiveHub(
    routes,
    () => {
      attempts++;
      throw new Error("offline");
    },
    { retryMs: 5, random: () => 0 },
  );
  const release = hub.acquire();
  assert.equal(hub.snapshot("1").status, "reconnecting");
  await sleep(20);
  assert.ok(attempts >= 2 && attempts <= 4);
  release();
  hub.stop();
});

test("disabled HTTP service never opens the upstream", async () => {
  const hub = new LiveHub(routes, () => {
    throw new Error("must not connect");
  });
  const server = createLiveServer(hub, { enabled: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/live/vehicles?route=1`)).status,
      503,
    );
    assert.equal(hub.clientCount, 0);
  } finally {
    hub.stop();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
