import { LIVE_TTL_MS, type LiveStatus, type LiveVehicle } from "./types/live";

export interface CacheClock {
  wall: number;
  monotonic: number;
}

/** Receipt age is server-relative; only elapsed local time is added here.
 * Use both clocks so system sleep expires old observations even on browsers
 * that pause performance.now, and a wall-clock rollback never freshens them. */
export function elapsedSince(start: CacheClock, now: CacheClock): number {
  return Math.max(0, now.wall - start.wall, now.monotonic - start.monotonic);
}

/** Short-lived, in-memory display cache; never a history or a saved position.
 * Keep the original receipt ages rather than resetting TTL on tab resume. */
export function projectCachedVehicles(
  vehicles: LiveVehicle[],
  receiptAges: Record<string, number>,
  elapsed: number,
): { vehicles: LiveVehicle[]; ages: Record<string, number> } {
  const ages: Record<string, number> = {};
  const visible = vehicles.filter((v) => {
    const age =
      Math.max(0, receiptAges[v.id] ?? LIVE_TTL_MS) + Math.max(0, elapsed);
    if (age >= LIVE_TTL_MS) return false;
    ages[v.id] = age;
    return true;
  });
  return { vehicles: visible, ages };
}

/** A new connection may first report "connecting" with no observations.
 * That is not an authoritative removal. A live snapshot, even empty, is. */
export function shouldReplaceCachedVehicles(
  status: LiveStatus,
  count: number,
): boolean {
  return status === "live" || count > 0;
}
