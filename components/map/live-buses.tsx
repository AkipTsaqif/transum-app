"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { RouteDetail } from "@/utils/types/gtfs";
import { LIVE_STALE_MS, type LiveVehicle } from "@/utils/types/live";
import { LIVE_MOTION_MIN_ZOOM, useLiveMotion } from "@/hooks/use-live-motion";
import { useLiveShapes } from "@/hooks/use-live-shapes";
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

/**
 * Measured label widths, per route code.
 *
 * `measureText` used to run for every bus on every animation frame (thousands
 * of calls per frame with the viewport fleet visible). The width of a label
 * never changes, so it is measured once and cached.
 */
const widths = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;
const labelWidth = (label: string): number => {
  const cached = widths.get(label);
  if (cached !== undefined) return cached;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const width = measureCtx
    ? ((measureCtx.font = FONT), measureCtx.measureText(label).width)
    : 0;
  widths.set(label, width);
  return width;
};

/** One GeoJSON feature for a bus; shared by the React data and per-frame writes. */
const featureFor = (
  v: LiveVehicle,
  faded: boolean,
  mapBearing: number,
): Feature<Point> => {
  const width = badgeWidth(labelWidth(v.routeShortName));
  const heading = v.bearing;
  return {
    type: "Feature",
    id: v.id,
    properties: {
      id: v.id,
      route: v.routeShortName,
      color: v.routeColor,
      image: imageKey(v),
      arrow: heading === null ? null : arrowKey(v),
      heading,
      arrowOffset:
        heading === null
          ? [0, 0]
          : arrowOffset(width, screenHeading(heading, mapBearing)),
      faded: faded ? 0.4 : 1,
    },
    geometry: { type: "Point", coordinates: [v.longitude, v.latitude] },
  };
};

/**
 * Route pills with a heading arrow just outside the box.
 *
 * The pill stays screen-aligned and readable. The arrow is its own symbol: it
 * rotates with the bus in map space and is pushed out past the box edge, so a
 * bus with no known heading simply has no arrow.
 */
export function LiveBusLayers({
  vehicles,
  ages,
  zoom,
  selectedRouteId,
  selectedDetail,
}: {
  vehicles: LiveVehicle[];
  ages: Record<string, number>;
  zoom: number;
  selectedRouteId: string | null;
  selectedDetail: RouteDetail | null;
}) {
  const { current: map } = useMap();
  const shapeFor = useLiveShapes({
    vehicles,
    zoom,
    enabled: vehicles.length > 0,
    selectedRouteId,
    selectedDetail,
  });
  const [mapBearing, setMapBearing] = useState(0);
  /** Last pose written per bus, so only genuinely moved features are sent. */
  const written = useRef(new Map<string, string>());

  const onFrame = useCallback(
    (frame: LiveVehicle[]) => {
      const source = map?.getSource?.("live-buses") as
        { updateData?: (diff: unknown) => void } | undefined;
      if (!source?.updateData) return;
      const update: Feature<Point>[] = [];
      const seen = new Set<string>();
      for (const v of frame) {
        seen.add(v.id);
        const key = `${v.latitude.toFixed(6)},${v.longitude.toFixed(6)},${v.bearing ?? "x"}`;
        if (written.current.get(v.id) === key) continue;
        written.current.set(v.id, key);
        update.push(
          featureFor(v, (ages[v.id] ?? 0) >= LIVE_STALE_MS, mapBearing),
        );
      }
      const remove = [...written.current.keys()].filter((id) => !seen.has(id));
      if (!update.length && !remove.length) return;
      for (const id of remove) written.current.delete(id);
      try {
        source.updateData(remove.length ? { update, remove } : { update });
      } catch {
        // Source swapped mid-flight (style reload): the next React sync redraws.
      }
    },
    [map, ages, mapBearing],
  );

  const displayed = useLiveMotion(vehicles, ages, { zoom, shapeFor, onFrame });

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
      features: displayed.map((v) =>
        featureFor(v, (ages[v.id] ?? 0) >= LIVE_STALE_MS, mapBearing),
      ),
    }),
    [displayed, ages, mapBearing],
  );

  // A full re-upload resets the source; forget what the diff thought it wrote.
  useEffect(() => {
    written.current.clear();
  }, [geo]);

  return (
    <Source id="live-buses" type="geojson" data={geo}>
      <Layer
        id="live-bus-arrow"
        type="symbol"
        layout={{
          "icon-image": ["coalesce", ["get", "arrow"], ""],
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
