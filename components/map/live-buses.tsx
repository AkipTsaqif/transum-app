"use client";
import { useEffect } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import { LIVE_STALE_MS, type LiveVehicle } from "@/utils/types/live";

const imageKey = (v: LiveVehicle) =>
  `live-route-${encodeURIComponent(v.routeShortName)}-${v.routeColor.slice(1)}-${v.routeTextColor.slice(1)}`;

/** Fixed-screen route pills: no fleet numbers, arrow or rotation on the map. */
export function LiveBusLayers({
  vehicles,
  ages,
}: {
  vehicles: LiveVehicle[];
  ages: Record<string, number>;
}) {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    let registering = false;
    const register = () => {
      if (registering) return;
      registering = true;
      try {
        for (const v of vehicles) {
          const id = imageKey(v);
          if (map.hasImage(id)) continue;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          // System font rasterization avoids a new glyph/font dependency.
          ctx.font = "bold 12px sans-serif";
          const width = Math.max(
            28,
            Math.ceil(ctx.measureText(v.routeShortName).width) + 14,
          );
          canvas.width = width * 2;
          canvas.height = 48;
          ctx.scale(2, 2);
          ctx.fillStyle = v.routeColor;
          ctx.beginPath();
          ctx.roundRect(1, 1, width - 2, 22, 6);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,.9)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.font = "bold 12px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = v.routeTextColor;
          ctx.fillText(v.routeShortName, width / 2, 12);
          // addImage can emit styledata: the registering guard prevents re-entry.
          if (!map.hasImage(id))
            map.addImage(
              id,
              ctx.getImageData(0, 0, canvas.width, canvas.height),
              { pixelRatio: 2 },
            );
        }
      } finally {
        registering = false;
      }
    };
    register();
    map.on("styledata", register);
    return () => {
      map.off("styledata", register);
    };
  }, [map, vehicles]);
  const geo: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature",
      id: v.id,
      properties: {
        id: v.id,
        route: v.routeShortName,
        color: v.routeColor,
        image: imageKey(v),
        faded: (ages[v.id] ?? 0) >= LIVE_STALE_MS ? 0.4 : 1,
      },
      geometry: { type: "Point", coordinates: [v.longitude, v.latitude] },
    })),
  };
  return (
    <Source id="live-buses" type="geojson" data={geo}>
      <Layer
        id="live-bus-badge"
        type="symbol"
        layout={{
          "icon-image": ["get", "image"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 0,
        }}
        paint={{ "icon-opacity": ["get", "faded"] }}
      />
      <Layer
        id="live-bus-hit"
        type="circle"
        paint={{ "circle-radius": 22, "circle-opacity": 0 }}
      />
    </Source>
  );
}
