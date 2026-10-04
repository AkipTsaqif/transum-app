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

/** One route's full payload: ~27 KB average, fetched on click. */
export interface RouteDetail {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    geometry: ShapeCollection;
    stops: RouteStop[];
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

/** A route drawn on the map, paired with the colour to draw it in. */
export interface DrawnRoute {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
    route_color: string;
    geometry: ShapeCollection;
    stops: RouteStop[];
}
