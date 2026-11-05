/**
 * Follow a route shape between two observations.
 *
 * Generic on purpose: the live motion engine is not Transjakarta-specific, so
 * anything with a polyline can use this (bus, rail, ferry). Pure functions;
 * no network, no clock, no map dependency.
 *
 * The rule that matters: only return a path when the shape clearly explains
 * the movement. Otherwise callers fall back to a straight line, because a
 * wrong branch would be worse than a straight hop across a corner.
 */

export type LngLat = [number, number];

/** How far either observation may sit from the shape and still be trusted. */
export const LIVE_PATH_MAX_OFFSET_M = 30;
/** Reject a shape detour longer than this multiple of the straight distance. */
export const LIVE_PATH_MAX_DETOUR = 2;

export const metresBetween = (a: LngLat, b: LngLat): number =>
  Math.hypot(
    (a[0] - b[0]) * 111_320 * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
    (a[1] - b[1]) * 110_540,
  );

const project = (line: LngLat[], point: LngLat) => {
  let best = { distance: Infinity, segment: 0, t: 0, point: line[0] };
  const kx = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * kx;
    const py = (point[1] - a[1]) * 110_540;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
    const distance = Math.hypot(px - dx * t, py - dy * t);
    if (distance < best.distance)
      best = {
        distance,
        segment: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      };
  }
  return best;
};

export interface ShapePath {
  /** Polyline from the first observation to the second, along the shape. */
  points: LngLat[];
  /** Driven length in metres, used to interpolate at constant speed. */
  length: number;
}

/**
 * Sub-polyline of `shape` between two observations, or null when the shape
 * does not explain the movement (caller should draw a straight line):
 * - no usable shape;
 * - an observation sits too far off the shape;
 * - the projections run backwards (shape is for the opposite direction, or
 *   the bus looped past its own start);
 * - the driven path detours far more than the straight distance (wrong branch
 *   of a fork).
 */
export function shapePath(
  shape: readonly LngLat[] | null | undefined,
  from: LngLat,
  to: LngLat,
): ShapePath | null {
  if (!shape || shape.length < 2) return null;
  const line = shape as LngLat[];
  const a = project(line, from);
  const b = project(line, to);
  if (
    a.distance > LIVE_PATH_MAX_OFFSET_M ||
    b.distance > LIVE_PATH_MAX_OFFSET_M
  )
    return null;
  if (b.segment < a.segment) return null;
  if (b.segment === a.segment && b.t < a.t) return null;

  const points: LngLat[] = [a.point];
  for (let i = a.segment + 1; i <= b.segment; i++) points.push(line[i]);
  points.push(b.point);

  // Drop repeated points so the length and headings are meaningful.
  const unique = points.filter(
    (p, i) => i === 0 || metresBetween(p, points[i - 1]) > 0.05,
  );
  if (unique.length < 2) return null;

  let length = 0;
  for (let i = 0; i + 1 < unique.length; i++)
    length += metresBetween(unique[i], unique[i + 1]);

  const straight = metresBetween(from, to);
  if (straight > 1 && length > straight * LIVE_PATH_MAX_DETOUR) return null;
  return { points: unique, length };
}

/** Position along a path at normalised distance `t` (0 = start, 1 = end). */
export function samplePath(path: ShapePath, t: number): LngLat {
  const clamped = Math.max(0, Math.min(1, t));
  const target = path.length * clamped;
  let travelled = 0;
  for (let i = 0; i + 1 < path.points.length; i++) {
    const a = path.points[i];
    const b = path.points[i + 1];
    const step = metresBetween(a, b);
    if (travelled + step >= target || i + 2 === path.points.length) {
      const inner = step
        ? Math.max(0, Math.min(1, (target - travelled) / step))
        : 0;
      return [a[0] + (b[0] - a[0]) * inner, a[1] + (b[1] - a[1]) * inner];
    }
    travelled += step;
  }
  return path.points[path.points.length - 1];
}

/** Degrees clockwise from north (0..360), or null for a zero-length step. */
export const headingBetween = (a: LngLat, b: LngLat): number | null => {
  const north = (b[1] - a[1]) * 110_540;
  const east =
    (b[0] - a[0]) * 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  if (Math.hypot(north, east) < 1) return null;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
};

/**
 * Local heading at `t`, sampled a short distance either side so it follows the
 * road through a turn instead of the chord between the endpoints.
 */
export function pathHeading(path: ShapePath, t: number): number | null {
  const span = path.length ? Math.min(20 / path.length, 0.25) : 0;
  const back = samplePath(path, Math.max(0, t - span));
  const ahead = samplePath(path, Math.min(1, t + span));
  return headingBetween(back, ahead);
}
