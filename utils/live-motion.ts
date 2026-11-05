import { LIVE_STALE_MS, type LiveVehicle } from "./types/live";

export const LIVE_MOVE_MS = 900;
/** Display-only guardrails, not a claim about upstream GPS accuracy. */
export const LIVE_MOVE_MAX_METRES = 250;
export const LIVE_MOVE_MAX_GAP_MS = 15_000;

type Pose = Pick<LiveVehicle, "latitude" | "longitude" | "bearing">;
interface Transition {
  from: Pose;
  target: LiveVehicle;
  startedAt: number;
  duration: number;
}

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
  const { from, target, startedAt, duration } = transition;
  const t = duration
    ? Math.max(0, Math.min(1, (now - startedAt) / duration))
    : 1;
  return {
    latitude: from.latitude + (target.latitude - from.latitude) * t,
    longitude: from.longitude + (target.longitude - from.longitude) * t,
    bearing: interpolateBearing(from.bearing, target.bearing, t),
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
  ): void {
    const next = new Map<string, Transition>();
    for (const target of vehicles) {
      const old = this.entries.get(target.id);
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
      next.set(target.id, {
        from: animate ? from : target,
        target,
        startedAt: now,
        duration: animate ? LIVE_MOVE_MS : 0,
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

  isMoving(now: number): boolean {
    return [...this.entries.values()].some(
      (entry) => entry.duration > 0 && now < entry.startedAt + entry.duration,
    );
  }
}
