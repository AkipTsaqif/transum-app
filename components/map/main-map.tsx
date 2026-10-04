"use client";

import MapGL, {
    Layer,
    Marker,
    NavigationControl,
    Source,
    type MapRef,
} from "react-map-gl/maplibre";
import {
    setWorkerUrl,
    type LngLatBoundsLike,
    type StyleSpecification,
} from "maplibre-gl";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import { useTheme } from "next-themes";
import type { RouteStop, ShapeCollection } from "@/utils/types/gtfs";
import { BusFront } from "lucide-react";
import { haversine, removeOppStopPrefix } from "@/utils/helper-fn";

/**
 * MapLibre v6 loads its tile-processing worker from a URL it derives from its
 * own `import.meta.url`. A bundler content-hashes that filename, so the
 * derived path 404s and the worker never starts -- the map then renders its
 * background and silently requests no tiles.
 *
 * `scripts/copy-maplibre-worker.mjs` places the worker (and the sibling chunk
 * it imports) in `public/maplibre/`, so point MapLibre at that stable path.
 * Must happen before the first Map is constructed; module scope guarantees it.
 */
if (typeof window !== "undefined") {
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}

const EMPTY_GEOJSON: ShapeCollection = {
    type: "FeatureCollection",
    features: [],
};

/**
 * Basemap. Default is OpenFreeMap "Positron": a desaturated grey-and-white
 * style with no key, no signup and no rate limit.
 *
 * Standard OSM raster was too busy -- its red/orange arterials and green parks
 * compete directly with the route colours drawn on top, so a red BRT corridor
 * disappeared into the road beneath it. Positron pushes the basemap back to
 * near-greyscale, which is the conventional choice for data overlays.
 *
 * Rejected: CARTO Positron/Voyager return HTTP 200 with an "API KEY REQUIRED"
 * watermark tile rather than a 4xx, so they look fine to a status check and
 * broken on screen. Stadia's equivalents return a real 401.
 *
 * MapTiler is still used when a key is present.
 *
 * The dark variant pairs with the app's dark mode. Note OpenFreeMap calls it
 * `dark`, not `dark-matter` -- the latter 404s.
 */
const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const mapStyleFor = (dark: boolean): string =>
    KEY
        ? `https://api.maptiler.com/maps/${dark ? "dataviz-dark" : "dataviz"}/style.json?key=${KEY}`
        : `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;

export interface DrawnLayer {
    id: string;
    color: string;
    geometry: ShapeCollection;
}

interface MainMapComponentProps {
    /** One entry per route to draw. Multiple when a stop is selected. */
    layers: DrawnLayer[];
    routeStops: RouteStop[];
    /** Every route, faint, shown only when nothing is selected. */
    overview?: ShapeCollection | null;
    /** Every station as points; GPU-rendered above `allStopsZoom`. */
    allStops?: FeatureCollection | null;
    onStationClick?: (name: string, lat: number, lon: number) => void;
    /** Fired the first time the user crosses into all-stops territory. */
    onNeedAllStops?: () => void;
    /** Pin for the currently selected station, if any. */
    activeStop?: { lat: number; lon: number; name: string } | null;
    onStopClick?: (stop: RouteStop) => void;
}

interface Cluster {
    lat: number;
    lon: number;
    count: number;
    name: string;
    /** A representative member, used to resolve the station on click. */
    stop: RouteStop;
}

/**
 * Tight bounding box around every coordinate in the route's geometry.
 * Returns null for empty geometry so callers can skip the camera move.
 */
function geometryBounds(
    geometry: ShapeCollection | null
): LngLatBoundsLike | null {
    if (!geometry?.features.length) return null;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const f of geometry.features) {
        for (const [lon, lat] of f.geometry.coordinates) {
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            if (lon < minLon) minLon = lon;
            if (lat < minLat) minLat = lat;
            if (lon > maxLon) maxLon = lon;
            if (lat > maxLat) maxLat = lat;
        }
    }

    if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;

    return [
        [minLon, minLat],
        [maxLon, maxLat],
    ];
}

/**
 * Merges stops that share a base name and sit within `nearbyThreshold` metres,
 * so a stop and its "Sbr." (across-the-road) twin render as one pin.
 *
 * Clusters are keyed by index rather than by a stringified coordinate, so the
 * running centroid is what gets rendered -- and a comma in a stop name can
 * never corrupt the key.
 */
function clusterStops(stops: RouteStop[], nearbyThreshold: number): Cluster[] {
    const clusters: Cluster[] = [];

    for (const stop of stops) {
        const name = removeOppStopPrefix(stop.stop_name);
        const lat = stop.stop_lat;
        const lon = stop.stop_lon;

        let merged = false;
        for (const c of clusters) {
            if (c.name !== name) continue;
            if (haversine(lat, lon, c.lat, c.lon) >= nearbyThreshold) continue;

            c.lat = (c.lat * c.count + lat) / (c.count + 1);
            c.lon = (c.lon * c.count + lon) / (c.count + 1);
            c.count += 1;
            merged = true;
            break;
        }

        if (!merged)
            clusters.push({ lat, lon, count: 1, name, stop });
    }

    return clusters;
}

const StopMarkers = React.memo(function StopMarkers({
    clusters,
    activeName,
    onStopClick,
}: {
    clusters: Cluster[];
    activeName?: string | null;
    onStopClick?: (stop: RouteStop) => void;
}) {
    return (
        <>
            {clusters.map((c) => {
                const isActive = activeName === c.name;
                return (
                    <Marker
                        key={`${c.name}:${c.lat.toFixed(5)},${c.lon.toFixed(5)}`}
                        latitude={c.lat}
                        longitude={c.lon}
                        anchor="center"
                        onClick={(e) => {
                            // Without this the map swallows the click and pans.
                            e.originalEvent.stopPropagation();
                            onStopClick?.(c.stop);
                        }}
                    >
                        <button
                            type="button"
                            aria-label={`Halte ${c.name}`}
                            title={c.name}
                            className={`flex cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-125 ${
                                isActive
                                    ? "bg-white p-1.5 ring-2 ring-jakarta"
                                    : "bg-jakarta p-1"
                            }`}
                        >
                            <BusFront
                                size={isActive ? 13 : 10}
                                strokeWidth={2}
                                className={
                                    isActive ? "text-jakarta" : "text-white"
                                }
                            />
                        </button>
                    </Marker>
                );
            })}
        </>
    );
});

/**
 * Labels for the clustered route stops.
 *
 * Rendered as a MapLibre symbol layer rather than DOM nodes so the collision
 * engine can place them: `text-allow-overlap: false` hides a label that cannot
 * fit, and `text-variable-anchor` first tries moving it around the pin -- right,
 * left, above, below -- before giving up. DOM labels had a fixed offset and
 * simply overlapped each other.
 */
const StopLabels = React.memo(function StopLabels({
    clusters,
    activeName,
    textFont,
}: {
    clusters: Cluster[];
    activeName?: string | null;
    textFont: string[];
}) {
    const data = useMemo<FeatureCollection>(
        () => ({
            type: "FeatureCollection",
            features: clusters.map((c) => ({
                type: "Feature",
                properties: {
                    name: c.name,
                    // Keeps the selected stop's label on screen even in a
                    // crowded corridor.
                    priority: activeName === c.name ? 1 : 0,
                },
                geometry: { type: "Point", coordinates: [c.lon, c.lat] },
            })),
        }),
        [clusters, activeName]
    );

    return (
        <Source id="route-stop-labels" type="geojson" data={data}>
            <Layer
                id="route-stop-label"
                type="symbol"
                layout={{
                    "text-field": ["get", "name"],
                    // MapLibre defaults to "Open Sans Regular", which
                    // OpenFreeMap does not host -- the glyph request 404s and
                    // every label silently disappears. Their styles ship
                    // Noto Sans.
                    "text-font": textFont,
                    "text-size": 11,
                    "text-max-width": 8,
                    // Try each position in turn until one is free.
                    "text-variable-anchor": [
                        "left",
                        "right",
                        "top",
                        "bottom",
                        "top-left",
                        "top-right",
                        "bottom-left",
                        "bottom-right",
                    ],
                    // Distance from the pin, in ems, for every anchor above.
                    "text-radial-offset": 0.9,
                    "text-justify": "auto",
                    "text-allow-overlap": false,
                    "text-ignore-placement": false,
                    // Higher priority is placed first, so it wins collisions.
                    "symbol-sort-key": ["-", 0, ["get", "priority"]],
                }}
                paint={{
                    "text-color": "#0C1B2A",
                    "text-halo-color": "#FFFFFF",
                    "text-halo-width": 1.5,
                }}
            />
        </Source>
    );
});

const MainMapComponent = ({
    layers,
    routeStops,
    overview,
    allStops,
    activeStop,
    onStopClick,
    onStationClick,
    onNeedAllStops,
}: MainMapComponentProps) => {
    // Auto-fit frames a whole route at roughly z11-z13, so the old "> 12"
    // marker gate hid every stop the moment fitBounds finished. Pins are cheap
    // (tens per route, clustered) -- show them as soon as a route is framed,
    // and keep labels for when the user is actually zoomed in.
    const zoomThreshold = 10;
    // Auto-fit frames a trunk anywhere from z11.9 to z15.8 depending on how
    // long it is, so a high fixed gate hid labels on most routes right after
    // the camera settled. Collision placement already drops labels that will
    // not fit, so the gate only needs to stop the far-out view being noisy.
    const labelThreshold = 11;
    const nearbyThreshold = 55;
    /** Below this, 6,437 pins would be an unreadable smear. */
    const allStopsZoom = 14;

    const mapRef = useRef<MapRef | null>(null);

    // `resolvedTheme` collapses "system" to the actual light/dark value.
    const { resolvedTheme } = useTheme();
    const mapStyle = useMemo(
        () => mapStyleFor(resolvedTheme === "dark"),
        [resolvedTheme]
    );

    // Uncontrolled camera (initialViewState + no `onMove` write-back) so
    // fitBounds can animate freely. A controlled viewState would be re-applied
    // by React on every frame and fight the easing.
    const [zoomLevel, setZoomLevel] = useState(10);

    const handleMove = useCallback((e: { viewState: { zoom: number } }) => {
        // Quantise: markers only care about whole zoom steps, so this re-renders
        // ~once per zoom level instead of once per animation frame.
        setZoomLevel((prev) => {
            const next = Math.floor(e.viewState.zoom);
            return next === prev ? prev : next;
        });
    }, []);

    /**
     * Font stack for our own symbol layers.
     *
     * MapLibre defaults to "Open Sans Regular". OpenFreeMap only hosts Noto
     * Sans, so that default 404s and every label silently vanishes. Rather
     * than hardcode one basemap's fonts, borrow whatever the loaded style
     * already uses -- that is guaranteed to resolve against its glyph server.
     */
    const [textFont, setTextFont] = useState<string[]>(["Noto Sans Regular"]);

    const adoptStyleFont = useCallback(() => {
        const map = mapRef.current?.getMap?.();
        const layers = map?.getStyle?.()?.layers ?? [];
        for (const l of layers) {
            const f = (l as { layout?: { "text-font"?: unknown } }).layout?.[
                "text-font"
            ];
            if (Array.isArray(f) && typeof f[0] === "string") {
                setTextFont(f as string[]);
                return;
            }
        }
    }, []);

    // Clustering is O(n^2); keep it out of the render path on every pan.
    const routeClusters = useMemo(
        () => clusterStops(routeStops, nearbyThreshold),
        [routeStops, nearbyThreshold]
    );

    // Ask for the stop layer the first time it could actually be shown, so a
    // visitor who never zooms in never downloads it.
    useEffect(() => {
        if (zoomLevel >= allStopsZoom) onNeedAllStops?.();
    }, [zoomLevel, allStopsZoom, onNeedAllStops]);

    // Union of every drawn layer, so a multi-route stop view frames them all.
    const bounds = useMemo(() => {
        const boxes = layers
            .map((l) => geometryBounds(l.geometry))
            .filter((b): b is [[number, number], [number, number]] =>
                Boolean(b)
            );
        if (!boxes.length) return null;

        return boxes.reduce(
            (acc, b) => [
                [Math.min(acc[0][0], b[0][0]), Math.min(acc[0][1], b[0][1])],
                [Math.max(acc[1][0], b[1][0]), Math.max(acc[1][1], b[1][1])],
            ],
            boxes[0]
        ) as LngLatBoundsLike;
    }, [layers]);

    // Frame the selected route. Depends on `bounds` (not `geometry`) so
    // re-selecting a route with identical extent does not re-animate.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !bounds) return;

        map.fitBounds(bounds, {
            // Leaves room for the stop labels, which extend to the right of
            // their pin, and keeps the line clear of the zoom controls.
            padding: { top: 64, bottom: 64, left: 64, right: 96 },
            // A single stop would otherwise zoom to maxZoom.
            maxZoom: 15,
            duration: 900,
            essential: true,
        });
    }, [bounds]);

    return (
        <MapGL
            ref={mapRef}
            // Clicking a GPU circle layer: hit-test by layer id, since these
            // are painted pixels rather than DOM nodes with their own handlers.
            interactiveLayerIds={
                allStops && zoomLevel >= allStopsZoom
                    ? ["all-stops-circle"]
                    : undefined
            }
            onClick={(e) => {
                const f = e.features?.[0];
                if (!f || f.layer?.id !== "all-stops-circle") return;
                const [lon, lat] = (f.geometry as Point).coordinates;
                onStationClick?.(
                    String(f.properties?.name ?? ""),
                    lat,
                    lon
                );
            }}
            cursor={"auto"}
            initialViewState={{
                latitude: -6.1907,
                longitude: 106.8228,
                zoom: 10,
            }}
            onMove={handleMove}
            onLoad={adoptStyleFont}
            onStyleData={adoptStyleFont}
            // Fills whatever the parent allots. A hard 100vh would overflow the
            // mobile layout, where the map shares the screen with a bottom sheet.
            style={{ width: "100%", height: "100%" }}
            mapStyle={mapStyle}
        >
            <NavigationControl position="bottom-right" />

            {/*
              The whole network, faint, as context. One GPU-rendered GeoJSON
              source -- not 240 React layers. Hidden once a route or stop is
              selected so the selection reads clearly.
            */}
            {overview && layers.length === 0 && (
                <Source id="overview" type="geojson" data={overview}>
                    <Layer
                        id="overview-line"
                        type="line"
                        layout={{ "line-join": "round", "line-cap": "round" }}
                        paint={{
                            // Colour travels in the feature, so all 700 lines
                            // stay a single draw call.
                            "line-color": ["get", "color"],
                            "line-opacity": 0.35,
                            // Thinner when zoomed out, where lines bunch up.
                            "line-width": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                9,
                                1,
                                13,
                                2.5,
                            ],
                        }}
                    />
                </Source>
            )}

            {/* A Source per route so each keeps its own colour. */}
            {layers.length === 0 ? (
                <Source id="shape-empty" type="geojson" data={EMPTY_GEOJSON}>
                    <Layer id="shape-line" type="line" />
                </Source>
            ) : (
                layers.map((l) => (
                    <Source
                        key={l.id}
                        id={`shape-${l.id}`}
                        type="geojson"
                        data={l.geometry}
                    >
                        <Layer
                            id={`shape-line-${l.id}`}
                            type="line"
                            layout={{
                                "line-join": "round",
                                "line-cap": "round",
                            }}
                            paint={{
                                "line-color": `#${l.color}`,
                                "line-width": 3,
                                // Slight transparency so overlapping corridors
                                // stay legible when many routes share a street.
                                "line-opacity": layers.length > 1 ? 0.75 : 1,
                            }}
                        />
                    </Source>
                ))
            )}

            {/*
              All stops, GPU-rendered. Only above `allStopsZoom`, where pins
              are far enough apart to read. 6,437 DOM markers would instead be
              6,437 React components plus an O(n^2) clustering pass.
            */}
            {allStops && zoomLevel >= allStopsZoom && (
                <Source id="all-stops" type="geojson" data={allStops}>
                    <Layer
                        id="all-stops-circle"
                        type="circle"
                        paint={{
                            "circle-radius": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                14,
                                2.5,
                                17,
                                5,
                            ],
                            "circle-color": "#0C1B2A",
                            "circle-stroke-width": 1.5,
                            "circle-stroke-color": "#FFFFFF",
                            "circle-opacity": 0.9,
                        }}
                    />
                    <Layer
                        id="all-stops-label"
                        type="symbol"
                        minzoom={15}
                        layout={{
                            "text-field": ["get", "name"],
                            "text-font": textFont,
                            "text-size": 11,
                            "text-max-width": 8,
                            // Same dodge-then-hide behaviour as the route
                            // labels, rather than a fixed offset below the pin.
                            "text-variable-anchor": [
                                "left",
                                "right",
                                "top",
                                "bottom",
                                "top-left",
                                "top-right",
                                "bottom-left",
                                "bottom-right",
                            ],
                            "text-radial-offset": 0.8,
                            "text-justify": "auto",
                            "text-allow-overlap": false,
                            // Busier interchanges win when labels collide.
                            "symbol-sort-key": ["-", 0, ["get", "routes"]],
                        }}
                        paint={{
                            "text-color": "#0C1B2A",
                            "text-halo-color": "#FFFFFF",
                            "text-halo-width": 1.5,
                        }}
                    />
                </Source>
            )}

            {zoomLevel > zoomThreshold && routeClusters.length > 0 && (
                <>
                    {/* Labels first: a symbol layer sits under the DOM markers
                        regardless, and this keeps the JSX order readable. */}
                    {zoomLevel >= labelThreshold && (
                        <StopLabels
                            clusters={routeClusters}
                            activeName={activeStop?.name ?? null}
                            textFont={textFont}
                        />
                    )}
                    <StopMarkers
                        clusters={routeClusters}
                        activeName={activeStop?.name ?? null}
                        onStopClick={onStopClick}
                    />
                </>
            )}
        </MapGL>
    );
};

export default MainMapComponent;
