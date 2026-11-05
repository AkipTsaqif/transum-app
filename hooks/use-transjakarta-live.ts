"use client";
import { useEffect, useRef, useState } from "react";
import {
  carryOverVehicles,
  liveScopeQuery,
  vehicleInScope,
} from "@/utils/live-scope";
import {
  elapsedSince,
  projectCachedVehicles,
  shouldReplaceCachedVehicles,
} from "@/utils/live-cache";
import {
  type LiveScope,
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
  (v.bearing === null || Number.isFinite(v.bearing)) &&
  typeof v.tripId === "string" &&
  Number.isFinite(v.receivedAt);

const scopeFromKey = (key: string): LiveScope => {
  const params = new URLSearchParams(key);
  return {
    routeId: params.get("route"),
    bounds: params.has("bbox")
      ? (params.get("bbox")!.split(",").map(Number) as LiveScope["bounds"])
      : null,
  };
};

/** Browser has no broker connection. Age uses elapsed local time + server-relative age. */
export function useTransjakartaLive(scope: LiveScope, enabled: boolean): State {
  const scopeKey = liveScopeQuery(scope);
  const [state, setState] = useState<State>(() => empty(""));
  // The last state the effect produced, so a new viewport stream can keep the
  // buses that are still inside its area instead of starting from nothing.
  const latest = useRef<State>(state);
  latest.current = state;
  useEffect(() => {
    if (!scopeKey || !enabled) return;
    // Reconstruct from the stable query so fresh bounds arrays do not reconnect each render.
    const currentScope = scopeFromKey(scopeKey);
    const before = latest.current;
    const kept = before.scopeKey
      ? carryOverVehicles(
          { scope: scopeFromKey(before.scopeKey), vehicles: before.vehicles },
          currentScope,
        )
      : [];
    const keptAges: Record<string, number> = {};
    for (const v of kept) keptAges[v.id] = before.ages[v.id] ?? 0;
    let disposed = false,
      source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null,
      attempts = 0;
    let lastFrameAt = 0;
    let current = kept;
    let receiptAges = keptAges;
    const clock = () => ({ wall: Date.now(), monotonic: performance.now() });
    let receivedClock = clock();
    let status: LiveStatus =
      kept.length && before.status === "live" ? "live" : "connecting";
    let waitingForFirstFrame = true;
    const refresh = () => {
      const cached = projectCachedVehicles(
        current,
        receiptAges,
        elapsedSince(receivedClock, clock()),
      );
      if (!disposed) setState({ scopeKey, status, ...cached });
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
      // A viewport move into a fresh area is not a lost connection: while the
      // carried-over buses are still showing, keep reporting "live".
      if (!(status === "live" && waitingForFirstFrame && kept.length))
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
          const incoming = p.vehicles.filter((v) =>
            validVehicle(v, currentScope),
          );
          if (shouldReplaceCachedVehicles(p.status, incoming.length)) {
            current = incoming;
            receiptAges = Object.fromEntries(
              current.map((v) => [
                v.id,
                Math.max(0, p.serverTime - v.receivedAt),
              ]),
            );
            receivedClock = clock();
          }
          waitingForFirstFrame = false;
          lastFrameAt = performance.now();
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
      // Keep the last observed positions in memory while hidden. On return
      // their original ages advance by the entire hidden/sleep interval;
      // the first authoritative live snapshot replaces the cache, even empty.
      status = document.hidden ? "disconnected" : "reconnecting";
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
      if (document.hidden) return;
      if (source && performance.now() - lastFrameAt > 25_000) scheduleRetry();
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
  if (!enabled) return empty(scopeKey);
  if (state.scopeKey === scopeKey) return state;
  // The scope just changed and the effect has not run yet. Never show the
  // previous route's buses, but a viewport-to-viewport move may keep the ones
  // still inside the new area rather than flashing an empty panel.
  const vehicles = state.scopeKey
    ? carryOverVehicles(
        { scope: scopeFromKey(state.scopeKey), vehicles: state.vehicles },
        scopeFromKey(scopeKey),
      )
    : [];
  if (!vehicles.length) return empty(scopeKey);
  const ages: Record<string, number> = {};
  for (const v of vehicles) ages[v.id] = state.ages[v.id] ?? 0;
  return {
    scopeKey,
    status: state.status === "live" ? "live" : "connecting",
    vehicles,
    ages,
  };
}
