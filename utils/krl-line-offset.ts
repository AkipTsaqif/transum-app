// MapLibre line-offset is measured in screen pixels, to the right of the
// coordinates' direction. The airport's two OSM directions run opposite ways;
// reverse the sign so both render on the same side of their shared tracks.
// Keep the baked route geometry and stop anchors on the physical railway.
export const AIRPORT_LINE_OFFSET_PX = 4;

export function airportLineOffset(
    routeId: string,
    coordinates: [number, number][]
): number {
    if (routeId !== "A" || coordinates.length < 2) return 0;
    return coordinates[0][0] > coordinates[coordinates.length - 1][0]
        ? AIRPORT_LINE_OFFSET_PX
        : -AIRPORT_LINE_OFFSET_PX;
}
