import { LIVE_STALE_MS, type LiveVehicle } from "./types/live";
import {
  pathHeading,
  samplePath,
  shapePath,
  type LngLat,
  type ShapePath,
} from "./live-path";

/**
 * Display transition timing.
 *
 * The glide lasts exactly as long as the bus's own fix interval, so the marker
 * is still moving when the next fix arrives instead of stopping and lurching
 * (median interval ~2.5 s against the old fixed 0.9 s glide). The clamp keeps
 * a chatty bus from twitching and a slow one from crawling behind reality: the
 * marker lags the fix by at most about one interval, never runs ahead of it.
 */
export const LIVE_MOVE_MIN_MS = 1_000;
export const LIVE_MOVE_MAX_MS = 6_000;
/** First fix of a bus, or any snap: no glide at all. */
export const LIVE_MOVE_SNAP_MS = 0;
/** Display-only guardrails, not a claim about upstream GPS accuracy. */
export const LIVE_MOVE_MAX_METRES = 250;
export const LIVE_MOVE_MAX_GAP_MS = 15_000;
/** Below this the bus counts as stopped, so its heading is held rather than jittered. */
export const LIVE_HOLD_HEADING_METRES = 5;

/** Clamp an observed inter-fix interval into a sensible glide duration. */
export const glideDuration = (intervalMs: number): number =>
  Math.min(LIVE_MOVE_MAX_MS, Math.max(LIVE_MOVE_MIN_MS, intervalMs));

type Pose = Pick<LiveVehicle, "latitude" | "longitude" | "bearing">;
interface Transition {
  from: Pose;
  target: LiveVehicle;
  startedAt: number;
  duration: number;
  /** Road geometry to follow, when one explains the move. Null = straight. */
  road: ShapePath | null;
}

/**
 * Optional geometry for a vehicle: any polyline will do, so this stays
 * independent of which operator or dataset supplied it.
 */
export type ShapeFor = (
  vehicle: LiveVehicle,
) => readonly LngLat[] | null | undefined;

export function interpolateBearing(
  from: number,
  to: number,
  t: number,
): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (((from + delta * t) % 360) + 360) % 360;
}
const distance = (a: Pose, b: Pose) =>
  Math.hypot(
    (b.longitude - a.longitude) *
      111_320 *
      Math.cos(((a.latitude + b.latitude) * Math.PI) / 360),
    (b.latitude - a.latitude) * 110_540,
  );
const poseAt = (transition: Transition, now: number): Pose => {
  const { from, target, startedAt, duration, road } = transition;
  const t = duration
    ? Math.max(0, Math.min(1, (now - startedAt) / duration))
    : 1;
  if (road && t < 1) {
    const [longitude, latitude] = samplePath(road, t);
    return {
      latitude,
      longitude,
      // The road knows the direction through a turn; the reported bearing of a
      // bus mid-corner is often stale for a second.
      bearing:
        pathHeading(road, t) ??
        (from.bearing === null || target.bearing === null
          ? target.bearing
          : interpolateBearing(from.bearing, target.bearing, t)),
    };
  }
  return {
    latitude: from.latitude + (target.latitude - from.latitude) * t,
    longitude: from.longitude + (target.longitude - from.longitude) * t,
    bearing:
      from.bearing === null || target.bearing === null
        ? target.bearing
        : interpolateBearing(from.bearing, target.bearing, t),
  };
};

/** Latest targets plus their short display transitions. No extrapolation,
 * network access, receipt-age changes, or retained history of removed buses. */
export class LiveMotion {
  private entries = new Map<string, Transition>();

  update(
    vehicles: LiveVehicle[],
    ages: Record<string, number>,
    now: number,
    reset = false,
    shapeFor?: ShapeFor,
  ): void {
    const next = new Map<string, Transition>();
    for (const raw of vehicles) {
      const old = this.entries.get(raw.id);
      // A stopped bus reports a wobbling bearing; hold the last confident one
      // so the arrow does not spin on the spot at a halte. Missing headings
      // also inherit the last one while stationary rather than vanishing.
      const target =
        old &&
        distance(old.target, raw) < LIVE_HOLD_HEADING_METRES &&
        old.target.bearing !== null &&
        (raw.bearing === null || raw.bearing !== old.target.bearing)
          ? { ...raw, bearing: old.target.bearing }
          : raw;
      const age = ages[target.id] ?? 0;
      const unchanged =
        old &&
        old.target.routeId === target.routeId &&
        old.target.latitude === target.latitude &&
        old.target.longitude === target.longitude &&
        old.target.bearing === target.bearing;
      if (!reset && age < LIVE_STALE_MS && unchanged) {
        // Snapshot clones/age ticks must not perpetually restart a transition.
        next.set(target.id, { ...old, target });
        continue;
      }
      const from = old ? poseAt(old, now) : target;
      const gap = old ? target.receivedAt - old.target.receivedAt : 0;
      const animate =
        !reset &&
        old &&
        old.target.routeId === target.routeId &&
        age < LIVE_STALE_MS &&
        gap > 0 &&
        gap <= LIVE_MOVE_MAX_GAP_MS &&
        distance(from, target) <= LIVE_MOVE_MAX_METRES;
      // Only follow a road when it actually explains this move; shapePath
      // rejects far-off observations, backwards travel and fork detours.
      const road =
        animate && shapeFor
          ? shapePath(
              shapeFor(target),
              [from.longitude, from.latitude],
              [target.longitude, target.latitude],
            )
          : null;
      next.set(target.id, {
        from: animate ? from : target,
        target,
        startedAt: now,
        duration: animate ? glideDuration(gap) : LIVE_MOVE_SNAP_MS,
        road,
      });
    }
    this.entries = next;
  }

  sample(now: number): LiveVehicle[] {
    return [...this.entries.values()].map((entry) => ({
      ...entry.target,
      ...poseAt(entry, now),
    }));
  }

  /** Duration of a bus's current display transition, 0 when it snapped. */
  durationOf(id: string): number {
    return this.entries.get(id)?.duration ?? 0;
  }

  isMoving(now: number): boolean {
    return [...this.entries.values()].some(
      (entry) => entry.duration > 0 && now < entry.startedAt + entry.duration,
    );
  }
}
