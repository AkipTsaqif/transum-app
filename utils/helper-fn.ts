import type { RouteStop } from "@/utils/types/gtfs";

export const haversine = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
};

/**
 * Relative luminance of a 6-digit hex colour, used to pick black or white
 * text. Falls back to 0 (treated as dark -> white text) for malformed input,
 * because GTFS `route_color` is routinely blank or junk.
 */
export const calculateLuminance = (hex: string | null | undefined) => {
    const clean = (hex ?? "").replace("#", "").trim();

    if (!/^[0-9a-f]{6}$/i.test(clean)) return 0;

    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Strips the "Sbr." (seberang / opposite side of the road) prefix so a stop
 * and its across-the-street twin share one base name and can be clustered.
 *
 *   "Sbr. PGC" -> "PGC"
 *
 * The regex eats the trailing whitespace too. A plain `.slice(4)` leaves a
 * leading space, which silently breaks the equality check in the clustering
 * loop -- that bug affected 1,502 stops in the current feed.
 */
export const removeOppStopPrefix = (stopName: string) => {
    return (stopName ?? "").replace(/^Sbr\.\s*/i, "").trim();
};

/**
 * Loose form of a place name, for matching a route's long name ("Stasiun
 * Palmerah - Transport Hub Dukuh Atas") against stop names ("St. Palmerah").
 * Expands the common abbreviations and drops direction/platform suffixes.
 */
const normalizePlace = (s: string | null | undefined) =>
    (s ?? "")
        .toLowerCase()
        .replace(/^sbr\.?\s*/, "")
        .replace(/\bst\.?(?=\s|$)/g, "stasiun")
        .replace(/\bterm\.?(?=\s|$)/g, "terminal")
        .replace(/\bjln?\.?(?=\s|$)/g, "jalan")
        .replace(/\bpel\.?(?=\s|$)/g, "pelabuhan")
        .replace(/\b(arah|jalur|peron)\s+\S+$/, "")
        .replace(/\bvia\b.*$/, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/** 3 exact, 2 one starts with the other, 1 one contains the other, else 0. */
const placeScore = (a: string, b: string): number => {
    const x = normalizePlace(a);
    const y = normalizePlace(b);
    if (!x || !y) return 0;
    if (x === y) return 3;
    if (x.startsWith(y + " ") || y.startsWith(x + " ")) return 2;
    if (x.includes(y) || y.includes(x)) return 1;
    return 0;
};

/**
 * Same physical station: identical base name within 200 m. A terminus is
 * often two platforms ("Ragunan" G00306 / G00307) with different stop_ids, so
 * comparing ids alone misses that a route starts and ends in one place.
 */
const sameStation = (a: RouteStop, b: RouteStop): boolean =>
    a.stop_id === b.stop_id ||
    (removeOppStopPrefix(a.stop_name).toLowerCase() ===
        removeOppStopPrefix(b.stop_name).toLowerCase() &&
        haversine(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon) < 200);

/**
 * The two terminals of a route, for a preview that shows only its ends.
 *
 * The pattern's own first and last stop are authoritative -- the long name is
 * often an area ("Pesanggrahan") rather than the stop the bus actually turns
 * at -- so they are used whenever they differ.
 *
 * A loop starts and ends at the same station (possibly on two
 * platforms), which would give one pin for a two-ended route. Only then is the long name consulted: the half of
 * "A - B" that does *not* match the loop's own stop is the far end, and the
 * stop on the pattern that best matches it is taken. If nothing matches well
 * enough, the stop farthest from the start stands in.
 */
export const routeTerminals = (
    longName: string,
    orderedStops: RouteStop[]
): RouteStop[] => {
    if (orderedStops.length === 0) return [];
    const first = orderedStops[0];
    const last = orderedStops[orderedStops.length - 1];
    if (!sameStation(first, last)) return [first, last];

    const rest = orderedStops.filter((s) => !sameStation(s, first));
    if (!rest.length) return [first];

    // The half of the name that is NOT the loop's own stop is the far end.
    // When neither half matches the start (or both do), there is no reliable
    // target and the farthest-stop fallback below decides.
    const parts = (longName ?? "")
        .split(/[ ]+-[ ]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    let target: string | null = null;
    if (parts.length >= 2) {
        const head = parts[0];
        const tail = parts[parts.length - 1];
        const h = placeScore(first.stop_name, head);
        const t = placeScore(first.stop_name, tail);
        if (h > t) target = tail;
        else if (t > h) target = head;
    }

    let far: RouteStop | undefined;
    if (target) {
        let best = 0;
        for (const s of rest) {
            const sc = placeScore(s.stop_name, target);
            if (sc > best) {
                best = sc;
                far = s;
            }
        }
        // A bare substring hit ("Kota" inside "Taman Kota") is too weak.
        if (best < 2) far = undefined;
    }

    if (!far) {
        let d = -1;
        for (const s of rest) {
            const v = haversine(first.stop_lat, first.stop_lon, s.stop_lat, s.stop_lon);
            if (v > d) {
                d = v;
                far = s;
            }
        }
    }
    return far ? [first, far] : [first];
};
