"use client";

import MapGL, {
    Layer,
    Marker,
    NavigationControl,
    Source,
} from "react-map-gl/maplibre";
import React, { useMemo, useState } from "react";
import type { RouteStop, ShapeCollection } from "@/utils/types/gtfs";
import { BusFront } from "lucide-react";
import { haversine, removeOppStopPrefix } from "@/utils/helper-fn";

const EMPTY_GEOJSON: ShapeCollection = {
    type: "FeatureCollection",
    features: [],
};

const MAP_STYLE = process.env.NEXT_PUBLIC_MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
    : // Keyless fallback so the map still renders on a fresh clone.
      "https://demotiles.maplibre.org/style.json";

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
