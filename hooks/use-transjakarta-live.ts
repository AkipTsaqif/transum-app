"use client";
import { useEffect, useState } from "react";
import { liveScopeQuery, vehicleInScope } from "@/utils/live-scope";
import {
  type LiveScope,
  LIVE_TTL_MS,
  type LiveSnapshot,
  type LiveStatus,
  type LiveVehicle,
} from "@/utils/types/live";

type State = {
  scopeKey: string;
  status: LiveStatus;
  vehicles: LiveVehicle[];
  ages: Record<string, number>;
};
const empty = (scopeKey: string): State => ({
  scopeKey,
  status: "disconnected",
  vehicles: [],
  ages: {},
});
const validVehicle = (v: LiveVehicle, scope: LiveScope) =>
  v &&
  typeof v.id === "string" &&
  typeof v.label === "string" &&
  typeof v.headsign === "string" &&
  typeof v.currentStop === "string" &&
  typeof v.nextStop === "string" &&
  typeof v.routeId === "string" &&
  typeof v.routeShortName === "string" &&
  /^#[A-Fa-f0-9]{6}$/.test(v.routeColor) &&
  /^#[A-Fa-f0-9]{6}$/.test(v.routeTextColor) &&
  vehicleInScope(v, scope) &&
  Number.isFinite(v.latitude) &&
  Number.isFinite(v.longitude) &&
  v.latitude >= -6.9 &&
  v.latitude <= -5.8 &&
  v.longitude >= 106.3 &&
  v.longitude <= 107.4 &&
  Number.isFinite(v.bearing) &&
  Number.isFinite(v.receivedAt);

/** Browser has no broker connection. Age uses elapsed local time + server-relative age. */
export function useTransjakartaLive(scope: LiveScope, enabled: boolean) {
  const scopeKey = liveScopeQuery(scope);
  const [state, setState] = useState<State>(() => empty(""));
  useEffect(() => {
    if (!scopeKey || !enabled) return;
    // Reconstruct from the stable query so fresh bounds arrays do not reconnect each render.
    const params = new URLSearchParams(scopeKey);
    const currentScope: LiveScope = {
      routeId: params.get("route"),
      bounds: params.has("bbox")
        ? (params.get("bbox")!.split(",").map(Number) as LiveScope["bounds"])
        : null,
    };
    let disposed = false,
      source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null,
      attempts = 0;
    let lastFrameAt = 0,
      frameAt = 0,
      serverTime = 0;
    let current: LiveVehicle[] = [];
    let status: LiveStatus = "connecting";
    const refresh = () => {
      const elapsed = frameAt ? performance.now() - frameAt : 0;
      const ages: Record<string, number> = {};
      const vehicles = current.filter((v) => {
        const age = Math.max(0, serverTime - v.receivedAt) + elapsed;
        ages[v.id] = age;
        return age < LIVE_TTL_MS;
      });
      if (!disposed) setState({ scopeKey, status, vehicles, ages });
    };
    const close = () => {
      source?.close();
      source = null;
    };
    const scheduleRetry = () => {
      close();
      if (disposed || document.hidden || !navigator.onLine || retry) return;
      status = "reconnecting";
      refresh();
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    };
    const connect = () => {
      if (disposed || document.hidden || !navigator.onLine) return;
      status = attempts ? "reconnecting" : "connecting";
      lastFrameAt = performance.now();
      refresh();
      const base = (process.env.NEXT_PUBLIC_LIVE_BASE_URL ?? "").replace(
        /\/$/,
        "",
      );
      source = new EventSource(`${base}/live/vehicles?${scopeKey}`);
      const connection = source;
      source.addEventListener("snapshot", (event) => {
        if (disposed || source !== connection) return;
        try {
          if (String((event as MessageEvent).data).length > 2_000_000)
            throw new Error("Snapshot too large");
          const p = JSON.parse((event as MessageEvent).data) as LiveSnapshot;
          if (
            p.scopeKey !== scopeKey ||
            !Number.isFinite(p.serverTime) ||
            !Array.isArray(p.vehicles) ||
            p.vehicles.length > 5000 ||
            !["live", "connecting", "reconnecting", "disconnected"].includes(
              p.status,
            )
          )
            throw new Error("Invalid snapshot");
          current = p.vehicles.filter((v) => validVehicle(v, currentScope));
          serverTime = p.serverTime;
          frameAt = lastFrameAt = performance.now();
          status = p.status;
          attempts = 0;
          refresh();
        } catch {
          scheduleRetry();
        }
      });
      source.onerror = () => {
        if (source === connection) scheduleRetry();
      };
    };
    const visibility = () => {
      close();
      if (retry) clearTimeout(retry);
      retry = null;
      // A resumed page starts from a new snapshot, never a stale hidden-tab cache.
      current = [];
      frameAt = 0;
      status = "disconnected";
      refresh();
      if (!document.hidden) connect();
    };
    const offline = () => {
      close();
      if (retry) clearTimeout(retry);
      retry = null;
      status = "reconnecting";
      refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", offline);
    window.addEventListener("online", visibility);
    const ticker = setInterval(() => {
      if (
        !document.hidden &&
        source &&
        performance.now() - lastFrameAt > 25_000
      )
        scheduleRetry();
      refresh();
    }, 1000);
    connect();
    return () => {
      disposed = true;
      close();
      if (retry) clearTimeout(retry);
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", visibility);
    };
  }, [scopeKey, enabled]);
  // Never show previous-route/viewport data while the new effect waits to run.
  return enabled && state.scopeKey === scopeKey ? state : empty(scopeKey);
}
