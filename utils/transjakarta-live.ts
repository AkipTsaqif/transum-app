import {
  LIVE_MAX_VEHICLES,
  LIVE_TTL_MS,
  type LiveVehicle,
  type LiveScope,
  type LiveRouteStyle,
} from "./types/live";
import { vehicleInScope } from "./live-scope";

function routeBadge(
  routeId: string,
  styles: ReadonlyMap<string, LiveRouteStyle>,
) {
  const style = styles.get(routeId);
  const hex = style?.color.replace(/^#/, "").toUpperCase();
  const color = hex && /^[A-F0-9]{6}$/.test(hex) ? hex : "00609C";
  const rgb = [0, 2, 4].map((i) => {
    const value = parseInt(color.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return {
    routeShortName: style?.shortName || routeId,
    routeColor: `#${color}`,
    routeTextColor: luminance > 0.179 ? "#000000" : "#FFFFFF",
  };
}

const text = (v: unknown, max = 160) =>
  typeof v === "string" ? v.slice(0, max).trim() : "";
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
// Broad Jabodetabek guard, not a route snap: never put invalid GPS on the sea.
const coordinates = (lat: unknown, lon: unknown): lat is number =>
  finite(lat) &&
  finite(lon) &&
  lat !== 0 &&
  lon !== 0 &&
  lat >= -6.9 &&
  lat <= -5.8 &&
  lon >= 106.3 &&
  lon <= 107.4;
export function sourceTime(v: unknown): number | null {
  if (!finite(v) || v <= 0) return null;
  if (v >= 1e12 && v < 1e14) return v;
  if (v >= 1e9 && v < 1e11) return v * 1000;
  return null;
}

/** Strict projection: no unvalidated fields, ETA guesses or source-time age rejection. */
export function normalizeLiveVehicle(
  input: unknown,
  routes: ReadonlyMap<string, string>,
  receivedAt: number,
  styles: ReadonlyMap<string, LiveRouteStyle> = new Map(),
): LiveVehicle | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (!coordinates(p.latitude, p.longitude)) return null;
  const routeId = routes.get(text(p.route_code, 40));
  const id = text(p.bus_body_no, 80);
  if (!routeId || !id) return null;
  let lat = p.latitude as number,
    lon = p.longitude as number;
  if (coordinates(p.snap_latitude, p.snap_longitude)) {
    // Reject remote snaps even if they are inside the broad operating area.
    const metres = Math.hypot(
      ((p.snap_latitude as number) - lat) * 111_000,
      ((p.snap_longitude as number) - lon) * 110_400,
    );
    if (metres <= 500) {
      lat = p.snap_latitude as number;
      lon = p.snap_longitude as number;
    }
  }
  const timestamp = sourceTime(p.timestamp);
  const offset = timestamp === null ? null : receivedAt - timestamp;
  const aligned = offset !== null && Math.abs(offset) <= 30_000;
  return {
    id,
    label: id,
    routeId,
    ...routeBadge(routeId, styles),
    tripId: text(p.trip_id, 80),
    headsign: text(p.trip_headsign),
    latitude: lat,
    longitude: lon,
    // Unknown is not north: a 0 default drew a confident arrow pointing the
    // wrong way for every bus whose feed omitted the heading.
    bearing: finite(p.bearing) ? ((p.bearing % 360) + 360) % 360 : null,
    currentStop: text(p.curr_stops),
    nextStop: text(p.next_stops),
    receivedAt,
    sourceTimestamp: timestamp,
    clockOffsetMs: aligned ? offset : null,
    clock: aligned ? "aligned" : "unverified",
  };
}

/** Latest state only. Duplicate/replayed packets never reset the observation TTL. */
export class LiveVehicleStore {
  private entries = new Map<string, LiveVehicle>();
  constructor(
    private routes: ReadonlyMap<string, string>,
    private limit = LIVE_MAX_VEHICLES,
    private styles: ReadonlyMap<string, LiveRouteStyle> = new Map(),
  ) {}
  get size() {
    return this.entries.size;
  }
  clear() {
    this.entries.clear();
  }
  ingest(input: unknown, now: number, retained = false): boolean {
    const v = normalizeLiveVehicle(input, this.routes, now, this.styles);
    if (!v) return false;
    const old = this.entries.get(v.id);
    if (old) {
      if (v.sourceTimestamp !== null && old.sourceTimestamp !== null) {
        const delta = v.sourceTimestamp - old.sourceTimestamp;
        if (delta <= 0) return false;
        const elapsed = now - old.receivedAt;
        // Advancing source time at roughly receipt pace is evidence of relative
        // clock alignment, not proof that the bus clock has correct UTC time.
        if (Math.abs(delta - elapsed) <= 10_000 && v.clock !== "aligned") {
          v.clock = "adjusted";
          const offset = now - v.sourceTimestamp;
          v.clockOffsetMs =
            old.clockOffsetMs === null
              ? offset
              : Math.min(old.clockOffsetMs, offset);
        }
      } else if (
        v.latitude === old.latitude &&
        v.longitude === old.longitude &&
        v.routeId === old.routeId &&
        v.headsign === old.headsign
      )
        return false;
    } else if (
      retained &&
      (v.sourceTimestamp === null ||
        Math.abs(now - v.sourceTimestamp) > LIVE_TTL_MS)
    ) {
      // A retained, old-clock initial sample has no progression evidence yet.
      return false;
    }
    // Refresh insertion order so bounding the map evicts least recently observed.
    this.entries.delete(v.id);
    this.entries.set(v.id, v);
    while (this.entries.size > this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
  snapshot(scope: string | LiveScope, now: number): LiveVehicle[] {
    const filter =
      typeof scope === "string" ? { routeId: scope, bounds: null } : scope;
    const out: LiveVehicle[] = [];
    for (const [id, v] of this.entries) {
      if (now - v.receivedAt >= LIVE_TTL_MS) this.entries.delete(id);
      else if (vehicleInScope(v, filter)) out.push(v);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}
