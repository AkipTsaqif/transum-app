/** The deliberately small public projection of the experimental bus feed. */
export type LiveStatus =
  "connecting" | "live" | "reconnecting" | "disconnected";
export type VehicleClock = "aligned" | "adjusted" | "unverified";

export type LiveBounds = [
  west: number,
  south: number,
  east: number,
  north: number,
];
export interface LiveScope {
  routeId: string | null;
  bounds: LiveBounds | null;
}
export interface LiveRouteStyle {
  shortName: string;
  color: string;
}

export interface LiveVehicle {
  id: string;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  /** GTFS trip id from the feed, used to find the shape the bus drives. May be empty. */
  tripId: string;
  label: string;
  headsign: string;
  latitude: number;
  longitude: number;
  /** Degrees clockwise from north, or null when the feed gives no usable heading. */
  bearing: number | null;
  currentStop: string;
  nextStop: string;
  /** Sidecar receipt time of the last advancing observation, not a browser clock. */
  receivedAt: number;
  /** Normalized epoch milliseconds; retained for ordering, not raw age filtering. */
  sourceTimestamp: number | null;
  /** Per-vehicle estimated source clock offset; never a global timezone shift. */
  clockOffsetMs: number | null;
  clock: VehicleClock;
}

/** Complete route snapshot, at most once per second, including TTL removals. */
export interface LiveSnapshot {
  routeId: string | null;
  scopeKey: string;
  status: LiveStatus;
  serverTime: number;
  vehicles: LiveVehicle[];
}

export const LIVE_STALE_MS = 30_000;
export const LIVE_TTL_MS = 90_000;
export const LIVE_MAX_VEHICLES = 5_000;
