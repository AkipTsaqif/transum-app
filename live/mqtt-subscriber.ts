import { randomBytes } from "node:crypto";
import mqtt from "mqtt";
import type { ConnectLive } from "./hub";

export const connectTransjakarta: ConnectLive = (events) => {
  const client = mqtt.connect("wss://mqtt.tj.co.id:8084/mqtt", {
    clientId: `mqttjs_${randomBytes(12).toString("hex")}`,
    protocolVersion: 4,
    clean: true,
    keepalive: 30,
    connectTimeout: 15_000,
    reconnectPeriod: 0,
    queueQoSZero: false,
    resubscribe: false,
    wsOptions: { maxPayload: 512 * 1024 },
  });
  let stopped = false;
  let subscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  const fail = () => {
    if (!stopped) events.failed();
  };
  client.on("connect", () => {
    subscriptionTimer = setTimeout(fail, 10_000);
    client.subscribe("/mobile_armada/#", { qos: 0 }, (err, grants) => {
      if (subscriptionTimer) clearTimeout(subscriptionTimer);
      subscriptionTimer = null;
      if (stopped) return;
      if (err || !grants?.length || grants.some((g) => Number(g.qos) >= 128))
        fail();
      else events.ready();
    });
  });
  client.on("message", (topic, bytes, packet) => {
    if (
      stopped ||
      !topic.startsWith("/mobile_armada/") ||
      bytes.length > 128 * 1024
    )
      return;
    try {
      events.message(JSON.parse(bytes.toString("utf8")), packet.retain);
    } catch {
      /* bad upstream packet, no log of fleet payload */
    }
  });
  client.on("error", fail);
  client.on("close", fail);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (subscriptionTimer) clearTimeout(subscriptionTimer);
      client.end(true);
    },
  };
};
