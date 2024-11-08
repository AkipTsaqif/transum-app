"use client";

import Map, {
    Layer,
    Marker,
    NavigationControl,
    Source,
} from "react-map-gl/maplibre";
import { useMemo, useState } from "react";
import { Shape, Stop } from "@/utils/types/gtfs";
import { BusFront } from "lucide-react";
import { haversine } from "@/utils/helper-fn";

interface MainMapComponentProps {
    shapes: Shape[];
    lineColor: string | undefined;
    routeStops: Stop[];
}

const MainMapComponent = ({
    shapes,
    lineColor = "FFFFFF",
    routeStops,
}: MainMapComponentProps) => {
    const zoomThreshold = 13;
    const nearbyThreshold = 25;
    const displayedStops = new Set<string>();

    const [viewState, setViewState] = useState({
        latitude: -6.1907,
        longitude: 106.8228,
        zoom: 11,
    });

    const groupedShapes: Record<string, [number, number][]> = shapes.reduce(
        (acc, shape) => {
            if (!acc[shape.shape_id]) {
                acc[shape.shape_id] = [];
            }
            acc[shape.shape_id].push([
                +shape.shape_pt_lon,
                +shape.shape_pt_lat,
            ]);
            return acc;
        },
        {} as Record<string, [number, number][]>
    );

    const geoJsonData = {
        type: "FeatureCollection",
        features: Object.keys(groupedShapes).map((shape_id) => ({
            type: "Feature",
            properties: { shape_id },
            geometry: {
                type: "LineString",
                coordinates: groupedShapes[shape_id],
            },
        })),
    };

    return (
        <Map
            {...viewState}
            onMove={(e) => setViewState(e.viewState)}
            style={{ width: "100%", height: "100vh" }}
            mapStyle={
                "https://api.maptiler.com/maps/streets/style.json?key=BrpsEqmYwqOM5P8UK511"
            }
        >
            <Source id="shape" type="geojson" data={geoJsonData}>
                <Layer
                    id="shape-line"
                    type="line"
                    paint={{
                        "line-color": `#${lineColor}`,
                        "line-width": 3,
                    }}
                />
            </Source>
            {routeStops.map((stop, index) => {
                const { stop_lat, stop_lon, stop_name } = stop;
                const key = `${stop_lat},${stop_lon}`;

                let shouldDisplayName = true;
                for (const displayedKey of Array.from(displayedStops)) {
                    const [lat, lon] = displayedKey.split(",").map(parseFloat);
                    const distance = haversine(+stop_lat, +stop_lon, lat, lon);
                    if (distance < nearbyThreshold) {
                        shouldDisplayName = false;
                        break;
                    }
                }

                if (shouldDisplayName) {
                    displayedStops.add(key);
                }

                return (
                    <Marker
                        key={stop.stop_id}
                        latitude={+stop_lat}
                        longitude={+stop_lon}
                        anchor="center"
                    >
                        <div className="bg-jakarta p-1 rounded-full">
                            <BusFront
                                size={10}
                                strokeWidth={2}
                                className="text-white"
                            />
                        </div>
                        {viewState.zoom >= zoomThreshold &&
                            shouldDisplayName && (
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "0",
                                        left: "2em",
                                        lineHeight: "1",
                                        padding: "2px 5px",
                                        borderRadius: "3px",
                                        fontSize: "12px",
                                        textAlign: "center",
                                        fontWeight: "bold",
                                        // color: `#${lineColor}`,
                                    }}
                                >
                                    {stop_name}
                                </div>
                            )}
                    </Marker>
                );
            })}
        </Map>
    );
};

export default MainMapComponent;
