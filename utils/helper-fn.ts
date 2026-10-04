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
