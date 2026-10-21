import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { StationAnchor } from "./types/gtfs";

export interface Interchange {
    id: string;
    name: string;
    lat: number;
    lon: number;
    anchors: StationAnchor[];
}

/** In a far-out view two real platforms can project to less than one pixel.
 * Give each track its own visible endpoint while preserving physical lat/lon
 * in the data and returning to geographic alignment as the map zooms in. */
export const INTERCHANGE_MIN_SEPARATION_PX = 26;

/**
 * Diameter of an ordinary station dot at a given zoom.
 *
 * Mirrors the `icon-size` ramp the map uses for `all-stop-dot`
 * (r5 + 2px stroke, scaled 0.62 at z12 to 1.25 at z17), which works out to
 * 7.44px and 15px across. Kept here so the interchange can size itself
 * against a normal stop instead of using a fixed number.
 */
export const stationDotDiameter = (zoom: number): number => {
    const z = Math.min(17, Math.max(12, zoom));
    return 7.44 + ((15 - 7.44) * (z - 12)) / (17 - 12);
};

/**
 * How far apart to draw an interchange's two platforms, in screen pixels.
 *
 * Proportional to the station dot, not fixed. A flat 26px looked fine next to
 * nothing, but at z12 it forced the platforms ~26px apart when their real
 * separation projects to about 1.4px -- the connector grew to roughly five
 * times a station dot and its end pips floated well clear of the track they
 * belong to. Scaling with the dot keeps the connector at a steady ~2.3x a
 * normal stop at every zoom, and keeps the two pips just clear of each other
 * (each pip is half a dot wide, so a gap of one dot is the minimum that
 * avoids overlap).
 */
export const interchangeSeparationPx = (zoom: number): number =>
    stationDotDiameter(zoom) * 1.15;

export const projectedInterchangeEndpoints = (
    points: [number, number][],
    minPixels = INTERCHANGE_MIN_SEPARATION_PX
): [number, number][] => {
    if (points.length !== 2) return points;
    const [a, b] = points;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length >= minPixels) return points;
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    // When two tracks project onto one pixel, use a vertical mini schematic
    // rather than silently dropping one platform under the other.
    const ux = length > 1 ? dx / length : 0;
    const uy = length > 1 ? dy / length : 1;
    return [
        [midX - ux * minPixels / 2, midY - uy * minPixels / 2],
        [midX + ux * minPixels / 2, midY + uy * minPixels / 2],
    ];
};

/**
 * Group physical platforms without moving either one off its own track.
 * The input is baked KRL station metadata, not an inferred pair of nearby
 * map symbols: proximity alone does not prove an interchange exists.
 */
export function interchangesFromStops(
    allStops: FeatureCollection | null | undefined
): Interchange[] {
    if (!allStops) return [];
    return allStops.features.flatMap((feature) => {
        if (feature.geometry.type !== "Point") return [];
        const { name, stationId, anchors } = feature.properties ?? {};
        if (
            typeof name !== "string" ||
            typeof stationId !== "string" ||
            !Array.isArray(anchors) ||
            anchors.length < 2
        ) return [];
        const valid = anchors.filter(
            (anchor): anchor is StationAnchor =>
                typeof anchor?.routeId === "string" &&
                typeof anchor?.stopId === "string" &&
                Number.isFinite(anchor?.lat) && Number.isFinite(anchor?.lon) &&
                /^#[0-9a-f]{6}$/i.test(anchor?.color)
        );
        if (valid.length < 2) return [];
        const [lon, lat] = feature.geometry.coordinates;
        return [{ id: stationId, name, lon, lat, anchors: valid }];
    });
}

/** Each interchange becomes ONE pill feature and ONE label/hit point. */
export function interchangeFeatures(
    groups: Interchange[],
    displayPoints?: (group: Interchange, points: [number, number][]) => [number, number][]
): {
    pills: FeatureCollection<LineString>;
    labels: FeatureCollection<Point>;
    endpoints: FeatureCollection<Point>;
} {
    const pills: Feature<LineString>[] = [];
    const labels: Feature<Point>[] = [];
    const endpoints: Feature<Point>[] = [];
    for (const group of groups) {
        const geographic = group.anchors.map((a): [number, number] => [a.lon, a.lat]);
        const points = displayPoints ? displayPoints(group, geographic) : geographic;
        if (points.length < 2) continue;
        // Connect the closest remaining platform to the growing interchange
        // rather than zig-zagging through arbitrary line/config ordering.
        // Multiple segments can share the same station ID and single label.
        const joined = [points[0]];
        const remaining = points.slice(1);
        while (remaining.length) {
            let bestIndex = 0;
            let bestDistance = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const distance = Math.min(...joined.map((point) =>
                    Math.hypot((point[0] - remaining[i][0]) * 110_700,
                        (point[1] - remaining[i][1]) * 110_540)
                ));
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            }
            const point = remaining.splice(bestIndex, 1)[0];
            let parent = joined[0];
            let distance = Infinity;
            for (const candidate of joined) {
                const next = Math.hypot((candidate[0] - point[0]) * 110_700,
                    (candidate[1] - point[1]) * 110_540);
                if (next < distance) {
                    distance = next;
                    parent = candidate;
                }
            }
            pills.push({
                type: "Feature",
                properties: { stationId: group.id, name: group.name },
                geometry: { type: "LineString", coordinates: [parent, point] },
            });
            joined.push(point);
        }
        // The centre is only for a single name/hit target, not a substitute
        // for any of the physical platform positions.
        labels.push({
            type: "Feature",
            properties: { stationId: group.id, name: group.name, routes: group.anchors.length },
            geometry: { type: "Point", coordinates: [
                points.reduce((sum, p) => sum + p[0], 0) / points.length,
                points.reduce((sum, p) => sum + p[1], 0) / points.length,
            ] },
        });
        for (const anchor of group.anchors) {
            endpoints.push({
                type: "Feature",
                properties: { stationId: group.id, name: group.name, routeId: anchor.routeId, color: anchor.color },
                geometry: { type: "Point", coordinates: displayPoints
                    ? displayPoints(group, [group.anchors.map((a): [number, number] => [a.lon, a.lat])][0])[group.anchors.indexOf(anchor)]
                    : [anchor.lon, anchor.lat] },
            });
        }
    }
    return {
        pills: { type: "FeatureCollection", features: pills },
        labels: { type: "FeatureCollection", features: labels },
        endpoints: { type: "FeatureCollection", features: endpoints },
    };
}
