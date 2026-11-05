"use client";
import { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import { LIVE_STALE_MS, type LiveVehicle } from "@/utils/types/live";
import { useLiveMotion } from "@/hooks/use-live-motion";
import {
  ARROW_HEIGHT,
  ARROW_WIDTH,
  BADGE_HEIGHT,
  arrowOffset,
  badgeWidth,
  screenHeading,
} from "@/utils/live-heading";

const FONT = "bold 10px sans-serif";
const ARROW_MARGIN = 1.25;

const imageKey = (v: LiveVehicle) =>
  `live-route2-${encodeURIComponent(v.routeShortName)}-${v.routeColor.slice(1)}-${v.routeTextColor.slice(1)}`;
const arrowKey = (v: LiveVehicle) => `live-arrow-${v.routeColor.slice(1)}`;

/** Measured once; the label width decides the box width and the arrow offset. */
let measureCtx: CanvasRenderingContext2D | null = null;
const labelWidth = (label: string): number => {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = FONT;
  return measureCtx.measureText(label).width;
};

/**
 * Route pills with a heading arrow just outside the box.
 *
 * The pill stays screen-aligned and readable. The arrow is its own symbol:
 * it rotates with the bus (`icon-rotate`, in map space, so turning the map
 * turns it too) and is pushed out past the box edge in that direction.
 */
export function LiveBusLayers({
  vehicles,
  ages,
}: {
  vehicles: LiveVehicle[];
  ages: Record<string, number>;
}) {
  const { current: map } = useMap();
  const displayed = useLiveMotion(vehicles, ages);
  // Whole degrees: the edge distance only changes visibly at that scale.
  const [mapBearing, setMapBearing] = useState(0);
  useEffect(() => {
    if (!map) return;
    const sync = () => setMapBearing(Math.round(map.getBearing()));
    sync();
    map.on("rotate", sync);
    return () => {
      map.off("rotate", sync);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    let registering = false;
    const register = () => {
      if (registering) return;
      registering = true;
      try {
        for (const v of vehicles) {
          const id = imageKey(v);
          if (!map.hasImage(id)) {
            const width = badgeWidth(labelWidth(v.routeShortName));
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            canvas.width = (width + 2) * 2;
            canvas.height = (BADGE_HEIGHT + 2) * 2;
            ctx.scale(2, 2);
            ctx.fillStyle = v.routeColor;
            ctx.beginPath();
            ctx.roundRect(1, 1, width, BADGE_HEIGHT, 5);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,.9)";
            ctx.lineWidth = 1.25;
            ctx.stroke();
            ctx.font = FONT;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = v.routeTextColor;
            ctx.fillText(
              v.routeShortName,
              width / 2 + 1,
              BADGE_HEIGHT / 2 + 1.5,
            );
            // addImage can emit styledata: the registering guard prevents re-entry.
            if (!map.hasImage(id))
              map.addImage(
                id,
                ctx.getImageData(0, 0, canvas.width, canvas.height),
                { pixelRatio: 2 },
              );
          }
          const arrow = arrowKey(v);
          if (!map.hasImage(arrow)) {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            const w = ARROW_WIDTH + ARROW_MARGIN * 2;
            const h = ARROW_HEIGHT + ARROW_MARGIN * 2;
            canvas.width = Math.ceil(w * 2);
            canvas.height = Math.ceil(h * 2);
            ctx.scale(2, 2);
            ctx.beginPath();
            ctx.moveTo(w / 2, ARROW_MARGIN);
            ctx.lineTo(ARROW_MARGIN + ARROW_WIDTH, ARROW_MARGIN + ARROW_HEIGHT);
            ctx.lineTo(ARROW_MARGIN, ARROW_MARGIN + ARROW_HEIGHT);
            ctx.closePath();
            ctx.fillStyle = v.routeColor;
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,.95)";
            ctx.lineWidth = 1.25;
            ctx.lineJoin = "round";
            ctx.stroke();
            if (!map.hasImage(arrow))
              map.addImage(
                arrow,
                ctx.getImageData(0, 0, canvas.width, canvas.height),
                { pixelRatio: 2 },
              );
          }
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

  const geo = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: displayed.map((v) => {
        const width = badgeWidth(labelWidth(v.routeShortName));
        return {
          type: "Feature",
          id: v.id,
          properties: {
            id: v.id,
            route: v.routeShortName,
            color: v.routeColor,
            image: imageKey(v),
            arrow: arrowKey(v),
            heading: v.bearing,
            arrowOffset: arrowOffset(
              width,
              screenHeading(v.bearing, mapBearing),
            ),
            faded: (ages[v.id] ?? 0) >= LIVE_STALE_MS ? 0.4 : 1,
          },
          geometry: {
            type: "Point",
            coordinates: [v.longitude, v.latitude],
          },
        };
      }),
    }),
    [displayed, ages, mapBearing],
  );
  return (
    <Source id="live-buses" type="geojson" data={geo}>
      <Layer
        id="live-bus-arrow"
        type="symbol"
        layout={{
          "icon-image": ["get", "arrow"],
          // Map space: a bus heading east stays pointing at the east on the
          // ground however the user rotates the map.
          "icon-rotation-alignment": "map",
          "icon-rotate": ["get", "heading"],
          "icon-offset": ["get", "arrowOffset"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 0,
        }}
        paint={{ "icon-opacity": ["get", "faded"] }}
      />
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
