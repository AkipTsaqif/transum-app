/**
 * Types for the *baked* GTFS data in `data/gtfs/`, not the raw feed.
 *
 * The sync script (`scripts/sync-gtfs.ts`) has already done the CSV parsing,
 * the route/trip/shape/stop_time joins, and the string->number coercion, so
 * these are real numbers rather than the all-strings shape GTFS CSV gives you.
 */

/** A row in the sidebar list. No geometry -- the whole index is ~41 KB. */
export interface RouteSummary {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_desc: string;
    /** Always a valid 6-digit hex (no `#`). Sync substitutes a grey fallback. */
    route_color: string;
    route_text_color: string;
}

export interface RouteStop {
    stop_id: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
    /** 1-based position along the route, for "halte ke-12 dari 28". */
    sequence: number;
}

export interface ShapeFeature {
    type: "Feature";
    properties: { shape_id: string };
    geometry: {
        type: "LineString";
        /** [lon, lat] pairs, sorted by shape_pt_sequence. */
        coordinates: [number, number][];
    };
}

export interface ShapeCollection {
    type: "FeatureCollection";
    features: ShapeFeature[];
}

/**
 * How a trip relates to its route's main pattern.
 *
 * Transjakarta files every pattern under one route_id, so a single route can
 * be 18 trips. These are our classification, not GTFS fields.
 */
export type VariantKind =
    /** Most frequent pattern in its direction -- the everyday service. */
    | "utama"
    /** Visits stops the trunk does not: a genuine alternative alignment. */
    | "alihan"
    /** Same corridor, finishes early (a strict subsequence of the trunk). */
    | "pendek"
    /** Returns to the stop it started from. */
    | "putaran";

export interface FrequencyWindow {
    start: string;
    end: string;
    headwaySecs: number;
}

export interface RouteVariant {
    trip_id: string;
    shape_id: string;
    direction_id: string;
    kind: VariantKind;
    headsign: string;
    /** "Gerbang Pemuda" from a via-headsign, else its first distinct stop. */
    via: string | null;
    service_id: string;
    headwaySecs: number | null;
    windows: FrequencyWindow[];
    stopCount: number;
    /** Stops this pattern adds relative to the trunk. */
    extraStops: string[];
    /** Trunk stops this pattern misses. */
    skippedStops: string[];
    stopIds: string[];
}

/** One route's full payload: ~24 KB gzipped, fetched on click. */
export interface RouteDetail {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    stops: RouteStop[];
    variants: RouteVariant[];
    /** shape_id -> [lon, lat][]. The client assembles the lines it needs. */
    geometryByShape: Record<string, [number, number][]>;
}

/**
 * A clustered station: one or more physical platforms sharing a base name
 * within ~55 m, e.g. a stop and its "Sbr." twin across the road. This is the
 * unit the map renders as a single pin.
 *
 * Server-side only -- the full index is 922 KB and never shipped to the client.
 */
export interface StationIndexEntry {
    id: string;
    name: string;
    lat: number;
    lon: number;
    platforms: number;
    /** route_ids calling at this station. */
    routes: string[];
    /** route_id -> [position along that route, total stops on it]. */
    positions: Record<string, [number, number]>;
}

/** A route calling at a station, with where along it the station sits. */
export interface StationRoute extends RouteSummary {
    position?: number;
    totalStops?: number;
}

/** What `/api/gtfs/stops/:id` returns: ~1-3 KB. */
export interface StationDetail {
    id: string;
    name: string;
    lat: number;
    lon: number;
    platforms: number;
    routes: StationRoute[];
}

/** One result from `/api/gtfs/search`. */
export interface StationSearchHit {
    name: string;
    lat: number;
    lon: number;
    routeCount: number;
}

/** A route drawn on the map, paired with the colour to draw it in. */
export interface DrawnRoute {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    geometry: ShapeCollection;
    stops: RouteStop[];
}
