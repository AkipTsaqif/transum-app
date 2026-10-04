"use client";

import MapGL, {
    Layer,
    Marker,
    NavigationControl,
    Source,
} from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import React, { useMemo, useState } from "react";
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
 * Keyless fallback basemap: OpenStreetMap raster tiles.
 *
 * NOT `demotiles.maplibre.org` -- that style is a world *political* map with
 * only country outlines and a #D8F2FF background, so at city zoom it is an
 * empty pale-blue canvas with no streets. It looks broken for a transit map.
 *
 * OSM tiles need no key, but do have a usage policy (no heavy/commercial
 * traffic): https://operations.osmfoundation.org/policies/tiles/
 * Set NEXT_PUBLIC_MAPTILER_KEY for production.
 */
const OSM_FALLBACK_STYLE: StyleSpecification = {
    version: 8,
    sources: {
        osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution:
                '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
    },
    layers: [
        { id: "osm", type: "raster", source: "osm" },
    ],
};

const MAP_STYLE: string | StyleSpecification = process.env
    .NEXT_PUBLIC_MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
    : OSM_FALLBACK_STYLE;

interface MainMapComponentProps {
    geometry: ShapeCollection | null;
    lineColor: string | undefined;
    routeStops: RouteStop[];
}

interface Cluster {
    lat: number;
    lon: number;
    count: number;
    name: string;
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

        if (!merged) clusters.push({ lat, lon, count: 1, name });
    }

    return clusters;
}

const StopMarkers = React.memo(function StopMarkers({
    stops,
    showLabels,
    nearbyThreshold,
}: {
    stops: RouteStop[];
    showLabels: boolean;
    nearbyThreshold: number;
}) {
    // Clustering is O(n^2); keep it out of the render path on every pan.
    const clusters = useMemo(
        () => clusterStops(stops, nearbyThreshold),
        [stops, nearbyThreshold]
    );

    return (
        <>
            {clusters.map((c) => (
                <Marker
                    key={`${c.name}:${c.lat.toFixed(5)},${c.lon.toFixed(5)}`}
                    latitude={c.lat}
                    longitude={c.lon}
                    anchor="center"
                >
                    <div className="bg-jakarta p-1 rounded-full">
                        <BusFront
                            size={10}
                            strokeWidth={2}
                            className="text-white"
                        />
                    </div>
                    {showLabels && (
                        <div className="absolute top-0 left-[2em] leading-none w-24 rounded-sm text-xs font-pt-sans-narrow font-bold">
                            {c.name}
                        </div>
                    )}
                </Marker>
            ))}
        </>
    );
});

const MainMapComponent = ({
    geometry,
    lineColor = "FFFFFF",
    routeStops,
}: MainMapComponentProps) => {
    const zoomThreshold = 12;
    const labelThreshold = 13;
    const nearbyThreshold = 55;

    const [viewState, setViewState] = useState({
        latitude: -6.1907,
        longitude: 106.8228,
        zoom: 10,
    });

    // Quantised so continuous zooming doesn't invalidate the memo every frame.
    const zoomLevel = Math.floor(viewState.zoom);

    return (
        <MapGL
            {...viewState}
            onMove={(e) => setViewState(e.viewState)}
            style={{ width: "100%", height: "100vh" }}
            mapStyle={MAP_STYLE}
        >
            <NavigationControl position="bottom-right" />

            <Source id="shape" type="geojson" data={geometry ?? EMPTY_GEOJSON}>
                <Layer
                    id="shape-line"
                    type="line"
                    layout={{ "line-join": "round", "line-cap": "round" }}
                    paint={{
                        "line-color": `#${lineColor}`,
                        "line-width": 3,
                    }}
                />
            </Source>

            {zoomLevel > zoomThreshold && routeStops.length > 0 && (
                <StopMarkers
                    stops={routeStops}
                    showLabels={zoomLevel >= labelThreshold}
                    nearbyThreshold={nearbyThreshold}
                />
            )}
        </MapGL>
    );
};

export default MainMapComponent;
