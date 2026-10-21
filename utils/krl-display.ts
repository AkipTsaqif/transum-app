import type { ShapeCollection, ShapeFeature } from "./types/gtfs";

export type LngLat = [number, number];
const distanceM = (a: LngLat, b: LngLat) =>
    Math.hypot((a[0] - b[0]) * 110_700, (a[1] - b[1]) * 110_540);

/** Manggarai's airport platform is drawn between the Bogor and Cikarang pips.
 * The baked station/track coordinates still describe their physical positions. */
export function airportManggaraiDisplayPoint(
    anchors: { routeId: string; lon: number; lat: number }[]
): LngLat | null {
    const bogor = anchors.find((anchor) => anchor.routeId === "B");
    const cikarang = anchors.find((anchor) => anchor.routeId === "C");
    return bogor && cikarang
        ? [(bogor.lon + cikarang.lon) / 2, (bogor.lat + cikarang.lat) / 2]
        : null;
}

/** Screen-space position of the airport's terminal pip on the offset line.
 * MapLibre offsets to the right of the direction of travel, with screen Y down.
 * Return pixels, never mutate the actual station location in the data. */
export function airportTerminalScreenPoint(
    before: [number, number],
    end: [number, number],
    offsetPx: number
): [number, number] {
    const dx = end[0] - before[0];
    const dy = end[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (!length) return end;
    return [end[0] - dy / length * offsetPx, end[1] + dx / length * offsetPx];
}

/** Separate the two sides of the airport route at Duri, where the OSM way
 * chain makes a short hairpin beyond the passenger platform and returns.
 * Each displayed side stops on the same pip instead of drawing past it. */
export function airportDisplayLine(
    coordinates: LngLat[],
    duri: LngLat,
    manggarai: LngLat
): LngLat[][] {
    if (coordinates.length < 5) return [coordinates];
    const line = [...coordinates];
    // Already split by the sync baker (overview). Do not split again when a
    // preview or other caller receives display geometry instead of raw OSM.
    const atDuri = (point: LngLat) => distanceM(point, duri) < 1;
    if (atDuri(line[0]) || atDuri(line.at(-1)!)) return [line];

    // Both airport directions end at Manggarai, one in reverse order.
    if (line[0][0] > line.at(-1)![0]) line[0] = manggarai;
    else line[line.length - 1] = manggarai;

    const close = line.map((point, index) => ({ index, distance: distanceM(point, duri) }))
        .filter((hit) => hit.distance < 100);
    if (close.length < 4) throw new Error("Airport route no longer passes Duri's platform twice");
    // The northernmost vertex in the local hairpin is the turnaround, not a
    // passenger stop. Find the closest approach on either side separately.
    const tip = close.reduce((best, hit) =>
        line[hit.index][1] > line[best.index][1] ? hit : best).index;
    const approach = close.filter((hit) => hit.index < tip);
    const departure = close.filter((hit) => hit.index > tip);
    if (!approach.length || !departure.length) {
        throw new Error("Airport Duri turn no longer has both approaches");
    }
    const before = approach.reduce((best, hit) => hit.distance < best.distance ? hit : best).index;
    const after = departure.reduce((best, hit) => hit.distance < best.distance ? hit : best).index;
    if (distanceM(line[before], duri) > 35 || distanceM(line[after], duri) > 35) {
        throw new Error("Airport Duri platform is no longer near both track approaches");
    }
    // Nearest vertices are ~22m north of the platform. Including them
    // leaves a visible stub beyond the pip, even though the final point is
    // Duri. Cut at the south-side vertex on each approach, then connect to
    // the pip. Adjacent OSM vertices on a northbound track can sit exactly
    // at the pip latitude, so require a modest gap rather than strict >.
    const northOfPip = (point: LngLat) => point[1] > duri[1] + 0.00008;
    let approachEnd = before;
    while (approachEnd > 0 && northOfPip(line[approachEnd])) approachEnd--;
    let departureStart = after;
    while (departureStart + 1 < line.length && northOfPip(line[departureStart])) departureStart++;
    if (approachEnd < 0 || departureStart >= line.length ||
        distanceM(line[approachEnd], duri) > 40 ||
        distanceM(line[departureStart], duri) > 40) {
        throw new Error("Airport Duri approach no longer brackets the platform");
    }
    return [
        [...line.slice(0, approachEnd + 1), duri],
        [duri, ...line.slice(departureStart)],
    ];
}

/** Display-only geometry: selected route, hover preview and network overview
 * all use the same split. Other lines and the baked shape remain untouched. */
export function airportDisplayFeatures(
    features: ShapeCollection,
    duri: LngLat,
    manggarai: LngLat,
    isAirport: (feature: ShapeFeature) => boolean
): ShapeCollection {
    return {
        ...features,
        features: features.features.flatMap((feature) =>
            isAirport(feature)
                ? airportDisplayLine(feature.geometry.coordinates as LngLat[], duri, manggarai)
                    .map((coordinates) => ({
                        ...feature,
                        geometry: { ...feature.geometry, coordinates },
                    }))
                : [feature]
        ),
    };
}

/** Spread the three pips at far zoom while keeping A exactly halfway along
 * the B-C connector. Return points in original anchor order. */
export function manggaraiDisplayPlatforms(
    points: [number, number][],
    routeIds: string[],
    minGapPx: number
): [number, number][] {
    const b = routeIds.indexOf("B");
    const c = routeIds.indexOf("C");
    const a = routeIds.indexOf("A");
    if (points.length !== 3 || b < 0 || c < 0 || a < 0) return points;
    const center: [number, number] = [
        (points[b][0] + points[c][0]) / 2,
        (points[b][1] + points[c][1]) / 2,
    ];
    const dx = points[c][0] - points[b][0];
    const dy = points[c][1] - points[b][1];
    const length = Math.hypot(dx, dy);
    const halfGap = Math.max(minGapPx, length / 2);
    const ux = length > 0 ? dx / length : 1;
    const uy = length > 0 ? dy / length : 0;
    const result = [...points];
    result[b] = [center[0] - ux * halfGap, center[1] - uy * halfGap];
    result[a] = center;
    result[c] = [center[0] + ux * halfGap, center[1] + uy * halfGap];
    return result;
}
