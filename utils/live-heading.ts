/**
 * Geometry of the live bus badge and its heading arrow, in logical pixels.
 *
 * The badge is a screen-aligned rounded box. The arrow is a separate symbol
 * that rotates with the bus's heading and sits just OUTSIDE the box edge in
 * that direction. MapLibre rotates an icon about its anchor and applies
 * `icon-offset` in the icon's own (rotated) frame, so the arrow only needs to
 * be pushed straight "up" by the distance from the box centre to its edge
 * along the heading. A fixed orbit radius would leave the arrow floating a
 * long way above a wide box when the bus heads north.
 */
export const BADGE_HEIGHT = 18;
export const BADGE_MIN_WIDTH = 24;
export const BADGE_PADDING_X = 12;
export const ARROW_WIDTH = 9;
export const ARROW_HEIGHT = 8;
/** Space between the box outline and the arrow tip's base. */
export const ARROW_GAP = 1;

/** Box width for a route label of the given measured text width. */
export const badgeWidth = (textWidth: number): number =>
  Math.max(BADGE_MIN_WIDTH, Math.ceil(textWidth) + BADGE_PADDING_X);

/**
 * Angle of the heading as it appears on screen, degrees clockwise from the
 * top of the screen. The map's own rotation turns every heading with it.
 */
export const screenHeading = (bearing: number, mapBearing: number): number =>
  (((bearing - mapBearing) % 360) + 360) % 360;

/** Distance from a box's centre to its edge along a screen heading. */
export function edgeDistance(
  width: number,
  height: number,
  screenAngle: number,
): number {
  const rad = (screenAngle * Math.PI) / 180;
  const across = Math.abs(Math.sin(rad));
  const up = Math.abs(Math.cos(rad));
  const toSide = across < 1e-9 ? Infinity : width / 2 / across;
  const toTop = up < 1e-9 ? Infinity : height / 2 / up;
  return Math.min(toSide, toTop);
}

/**
 * `icon-offset` for the arrow: straight along the icon's own up axis, far
 * enough that the arrow's base clears the box edge for this heading.
 */
export function arrowOffset(
  width: number,
  screenAngle: number,
): [number, number] {
  const distance =
    edgeDistance(width, BADGE_HEIGHT, screenAngle) + ARROW_GAP + ARROW_HEIGHT / 2;
  return [0, -Number(distance.toFixed(2))];
}
