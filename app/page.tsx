"use client";

import MainMapComponent, { type DrawnLayer } from "@/components/map/main-map";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  calculateLuminance,
  removeOppStopPrefix,
  routeTerminals,
} from "@/utils/helper-fn";
import type {
  RouteDetail,
  RouteStop,
  RouteSummary,
  ShapeCollection,
  StationDetail,
  StationSearchHit,
} from "@/utils/types/gtfs";
import type { FeatureCollection } from "geojson";
import { DualLine, SingleLine } from "@/components/route/route-line-diagram";
import { dualDiagramFor, singleDiagramFor } from "@/utils/line-diagram";
import { railLineOffset } from "@/utils/line-offset";
import { CITY_MODES, cityForMode, cityModes, isBusMode } from "@/utils/cities";
import {
  dataModeFor,
  groupRoutesByMode,
  mergeOverviews,
  mergeStopLayers,
  parseView,
  resolveStationMode,
  routeKey,
  splitRouteKey,
  type ModeRoute,
  type View,
} from "@/utils/all-modes";
import {
  connectionRoutes,
  samePlaceServices,
  walkingConnections,
  type NearbyConnection,
  type NearbyStation,
  type SamePlaceService,
} from "@/utils/nearby";
import { airportDisplayFeatures } from "@/utils/krl-display";

import { ArrowLeft, ChevronRight, MapPin, Route, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { TransitMode } from "@/lib/gtfs";

/** A station search hit plus the dataset it came from. */
type ModeStopHit = StationSearchHit & { mode: TransitMode };

/** What the mode picker offers. `ready: false` entries are listed but off. */
const MODES: { value: TransitMode; label: string; ready: boolean }[] = [
  { value: "gtfs", label: "Transjakarta", ready: true },
  { value: "krl", label: "KRL Commuter Line", ready: true },
  { value: "mrt", label: "MRT Jakarta", ready: true },
  { value: "lrt", label: "LRT Jakarta", ready: true },
  { value: "lrtj", label: "LRT Jabodebek", ready: true },
  {
    value: "bdg-kci",
    label: "Commuter Line Bandung Raya & Garut",
    ready: true,
  },
  { value: "bdg-kai", label: "KA Feeder Whoosh (PT KAI)", ready: true },
  { value: "bdg-mjt", label: "Metro Jabar Trans", ready: true },
  { value: "bdg-tmb", label: "Trans Metro Bandung", ready: true },
  { value: "bdg-damri", label: "Bus Kota DAMRI", ready: true },
  { value: "bdg-angkot", label: "Angkot Bandung", ready: true },
];
/**
 * Baked data is served with an hour-long browser cache in production, which is
 * correct there: it only changes at deploy. In development that backfires.
 * After `npm run sync:krl` rewrites `data/`, the browser keeps serving the old
 * JSON, and a hard reload does NOT clear `fetch()` responses -- only the
 * document. The symptom was confusing: a private window showed the new
 * geometry while the normal window kept the old one across server restarts.
 * Bypass the HTTP cache in development only; production is untouched.
 */
const NO_CACHE_IN_DEV: RequestInit =
  process.env.NODE_ENV === "production" ? {} : { cache: "no-store" };

/** One operator's lines at a station, for the merged station card. */
interface StationOperator {
  mode: TransitMode;
  name: string;
  lat: number;
  lon: number;
  routes: StationDetail["routes"];
}

const modeLabel = (m: View) =>
  m === "all"
    ? "Semua Moda · Jakarta"
    : m === "bandung-all"
      ? "Semua Moda · Bandung"
      : (MODES.find((x) => x.value === m)?.label ?? m);

export default function Index() {
  // What the picker shows: one dataset, or "all" of them together.
  // Semua Moda is the landing view: one map with every network on it, and
  // the picker can narrow to a single system from there.
  const [view, setView] = useState<View>("all");
  const isAll = view === "all" || view === "bandung-all";
  // A request number, not a boolean: each deliberate mode switch asks the map
  // to fit the new network exactly once, after its overview has loaded.
  // Starts at 1 because the FIRST load needs a fit too -- the fallback
  // initialViewState is a fixed Jakarta camera that leaves Bogor and
  // Rangkasbitung outside the frame, so "Semua Moda" looked like Transjakarta
  // only until the user switched datasets.
  const [overviewFitRequest, setOverviewFitRequest] = useState(1);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Every listed route, tagged with the dataset it comes from. In a single
  // mode they all share it; in the all view they span every mode.
  const [routes, setRoutes] = useState<ModeRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routesError, setRoutesError] = useState<string | null>(null);

  // Mode-qualified ("krl:A"): route ids are only unique within one mode.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Mobile bottom-sheet height. Ignored at md+ where the sidebar is a column.
  const [sheetOpen, setSheetOpen] = useState(false);

  // lg (1024px) and up: the route panel floats over the map beside a
  // narrower sidebar. Below that there is no room for a second panel, so it
  // lives at the top of the sidebar (the bottom sheet on phones) instead.
  const isWide = useMediaQuery("(min-width: 1024px)");

  // A stop picked from the route panel: the map flies there and highlights
  // it, but the station popup is not opened and the route stays selected.
  const [focusStop, setFocusStop] = useState<
    (RouteStop & { seq: number }) | null
  >(null);
  const focusStopAt = useCallback((s: RouteStop) => {
    setFocusStop((prev) => ({ ...s, seq: (prev?.seq ?? 0) + 1 }));
    // Phones: drop the sheet so the map is visible when it arrives.
    setSheetOpen(false);
  }, []);

  // Width of the floating panel, so fitBounds and stop focus keep the route
  // out from under it. Measured, not assumed: the panel is narrower for a
  // single line than for the two-direction diagram, and can be collapsed.
  const [cardWidth, setCardWidth] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Route under the pointer in the sidebar list. Drawn as a preview only --
  // it never feeds `layers`, so the map's fitBounds is not triggered.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverDetail, setHoverDetail] = useState<RouteDetail | null>(null);
  // Routes already fetched for a preview, so re-hovering is instant.
  const hoverCache = useRef(new Map<string, RouteDetail>());

  // Stop view: the clicked station, plus every route that calls there.
  // Faint city-wide network, shown only when nothing is selected.
  const [overview, setOverview] = useState<ShapeCollection | null>(null);
  // Every stop as points; fetched lazily the first time the user zooms in.
  const [allStops, setAllStops] = useState<FeatureCollection | null>(null);

  // Stop-name matches for the current query. Routes are filtered locally
  // from the index already on the client; stops live server-side.
  const [stopHits, setStopHits] = useState<ModeStopHit[]>([]);

  // Which pattern of the selected route to draw. null = the trunk(s).
  const [variantTripId, setVariantTripId] = useState<string | null>(null);

  const [station, setStation] = useState<StationDetail | null>(null);
  // Which dataset the open station was resolved from. In the all view a
  // station can belong to any mode; its routes must be fetched from there.
  const [stationMode, setStationMode] = useState<TransitMode | null>(null);
  // A multi-track interchange resolves to one station, but its popup must
  // open beside the platform the user actually clicked.
  const [stationAnchor, setStationAnchor] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationRoutes, setStationRoutes] = useState<RouteDetail[]>([]);
  // Cross-system transfers for the open station: stops of another service
  // within a short walk. Empty until the station resolves.
  const [connections, setConnections] = useState<NearbyConnection[]>([]);
  // Other operators calling at the SAME platforms, not a walk away.
  const [samePlace, setSamePlace] = useState<SamePlaceService[]>([]);
  // True once "tampilkan rute" has been pressed: the sidebar panel and the
  // drawn routes both follow from this, the popup alone does not.
  const [stationExpanded, setStationExpanded] = useState(false);

  const selectedRouteId = selectedKey
    ? (splitRouteKey(selectedKey)?.routeId ?? null)
    : null;
  const hoverRouteId = hoverKey
    ? (splitRouteKey(hoverKey)?.routeId ?? null)
    : null;
  /**
   * The dataset the CURRENT selection belongs to. A single-mode view always
   * uses its own; the all view takes it from the open station, else the
   * selected route, else none. Every mode-specific rule (KRL interchanges,
   * the airport and LRT offsets) keys on this, never on the view.
   */
  const mode: TransitMode | null = isAll
    ? (stationMode ?? dataModeFor(view, selectedKey))
    : (view as TransitMode);

  /** Concrete mode for the line-offset rules; "gtfs" has no offsets. */
  const lineMode: TransitMode = mode ?? "gtfs";
  /** The hovered route's own dataset, which may differ from the selection's. */
  const hoverMode: TransitMode | null = hoverKey
    ? (splitRouteKey(hoverKey)?.mode ?? null)
    : null;

  const cardShown = isWide && !station && !!detail;
  // What the card will measure once rendered -- w-96 when the route gets
  // the two-direction diagram, else w-72. fitBounds runs in the same commit
  // the route arrives in, before the card's ResizeObserver can report, so
  // the first framing must not depend on that measurement.
  const expectedCardWidth = useMemo(
    () =>
      detail &&
      detail.route_id !== "C" &&
      !variantTripId &&
      dualDiagramFor(detail)
        ? 384
        : 288,
    [detail, variantTripId],
  );
  useEffect(() => {
    const el = cardRef.current;
    if (!cardShown || !el) {
      setCardWidth(0);
      return;
    }
    // The card's own box, not the absolutely-positioned wrapper (which is
    // full-height but only as wide as its content).
    const measure = () =>
      setCardWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardShown]);

  // Switching dataset invalidates everything tied to the old one: the
  // selection and station, the hover preview and its cache, and the
  // city-wide stop layer (fetched lazily per mode).
  const switchView = useCallback(
    (next: View) => {
      if (next === view) return;
      abortRef.current?.abort();
      stationAbortRef.current?.abort();
      setSelectedKey(null);
      setVariantTripId(null);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setHoverKey(null);
      setHoverDetail(null);
      hoverCache.current.clear();
      setFocusStop(null);
      setStation(null);
      setStationMode(null);
      setConnections([]);
      setStationAnchor(null);
      setStationRoutes([]);
      setStationError(null);
      setStationLoading(false);
      setStationExpanded(false);
      setAllStops(null);
      stopLayers.current.clear();
      stopsPending.current.clear();
      stopGeneration.current += 1;
      setOverview(null);
      setRoutes([]);
      setSearchQuery("");
      setStopHits([]);
      setOverviewFitRequest((n) => n + 1);
      setView(next);
    },
    [view],
  );

  /** The datasets the current view draws from: one, or all of them. */
  const viewModes: readonly TransitMode[] = useMemo(
    () =>
      view === "all"
        ? CITY_MODES.jakarta
        : view === "bandung-all"
          ? CITY_MODES.bandung
          : [view as TransitMode],
    [view],
  );

  // Load the lightweight index once (~41 KB). Geometry is fetched per route.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setRoutesLoading(true);
      setRoutesError(null);
      try {
        // One request per dataset in view; tag each route with its
        // mode so later requests about it go to the right dataset.
        const lists = await Promise.all(
          viewModes.map(async (m) => {
            const res = await fetch(`/api/${m}/routes`, NO_CACHE_IN_DEV);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: RouteSummary[] = await res.json();
            return data.map((route): ModeRoute => ({ mode: m, route }));
          }),
        );
        if (!cancelled) setRoutes(lists.flat());
      } catch (err) {
        if (!cancelled) {
          setRoutesError("Gagal memuat daftar rute. Coba muat ulang halaman.");
          console.error("Failed to fetch route index:", err);
        }
      } finally {
        if (!cancelled) setRoutesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewModes]);

  // Load the overview once, after the route list -- it is context, not
  // content, so it must never delay the interactive part of the page.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // A missing mode's overview is non-fatal: the others still draw.
        const parts = await Promise.all(
          viewModes.map(async (m) => {
            try {
              const res = await fetch(`/api/${m}/overview`, NO_CACHE_IN_DEV);
              return {
                mode: m,
                overview: res.ok
                  ? ((await res.json()) as ShapeCollection)
                  : null,
              };
            } catch {
              return { mode: m, overview: null };
            }
          }),
        );
        const data = isAll
          ? (mergeOverviews(parts) as ShapeCollection)
          : parts[0].overview;
        if (!cancelled && data) setOverview(data);
      } catch {
        // Non-fatal: the map simply opens without the faint network.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewModes, isAll]);

  // Fetch the hovered route's geometry. The delay keeps a quick sweep down
  // the list from firing a request per row; only a pointer that rests on a
  // row loads it. Cached for the session after the first load.
  useEffect(() => {
    const hover = hoverKey ? splitRouteKey(hoverKey) : null;
    if (!hoverKey || !hover) {
      setHoverDetail(null);
      return;
    }
    const cached = hoverCache.current.get(hoverKey);
    if (cached) {
      setHoverDetail(cached);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/${hover.mode}/routes/${encodeURIComponent(hover.routeId)}`,
          { ...NO_CACHE_IN_DEV, signal: ctrl.signal },
        );
        if (!res.ok) return;
        const data: RouteDetail = await res.json();
        hoverCache.current.set(hoverKey, data);
        if (!ctrl.signal.aborted) setHoverDetail(data);
      } catch {
        // Aborted or offline: a preview is optional, so stay silent.
      }
    }, 120);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [hoverKey]);

  // Fetch one route's geometry + stops on selection (~27 KB).
  // An AbortController keeps fast clicking from racing stale responses in.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    const selected = selectedKey ? splitRouteKey(selectedKey) : null;
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // A new route starts on its trunk.
    setVariantTripId(null);
    // ...and with nothing focused from the previous route's panel.
    setFocusStop(null);

    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(
          `/api/${selected.mode}/routes/${encodeURIComponent(selected.routeId)}`,
          { ...NO_CACHE_IN_DEV, signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RouteDetail = await res.json();
        if (!ctrl.signal.aborted) setDetail(data);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setDetailError("Gagal memuat rute ini.");
        console.error("Failed to fetch route detail:", err);
      } finally {
        if (!ctrl.signal.aborted) setDetailLoading(false);
      }
    })();

    return () => ctrl.abort();
    // The key carries its mode, so the key alone decides the request.
  }, [selectedKey]);

  /**
   * Clicking a stop switches the map into "station mode": draw every route
   * that calls there, each in its own colour. Worst case in the current feed
   * is 14 routes (~290 KB); the median stop serves 1.
   */
  const stationAbortRef = useRef<AbortController | null>(null);

  /**
   * Clicking a stop only resolves the station itself -- name, platforms and
   * which routes call there. Drawing those routes is deferred to an explicit
   * button, because a busy interchange serves up to 14 routes and fetching
   * every geometry eagerly cost ~294 KB across 14 requests for what is
   * usually just "what is this stop called?".
   */
  const handleStopClick = useCallback(
    async (stop: RouteStop, stopMode?: TransitMode) => {
      // Whose station is this? An explicit mode (the all view's tagged dot
      // or search hit), the dataset already in focus, or -- for an
      // interchange pip in the all view -- the nearest loaded station of that
      // name. Without this last case a click in the all view resolved to no
      // dataset and was silently dropped.
      const owner = resolveStationMode(
        stopMode,
        mode,
        [...stopLayers.current.entries()].map(([layerMode, layer]) => ({
          mode: layerMode,
          layer,
        })),
        {
          name: removeOppStopPrefix(stop.stop_name),
          lat: stop.stop_lat,
          lon: stop.stop_lon,
        },
      );
      if (!owner) return;
      stationAbortRef.current?.abort();
      const ctrl = new AbortController();
      stationAbortRef.current = ctrl;

      // The station id is derived from the clustered name + centroid, which
      // the client cannot know exactly, so resolve by name and coordinate.
      const name = removeOppStopPrefix(stop.stop_name);
      const query = new URLSearchParams({
        name,
        lat: String(stop.stop_lat),
        lon: String(stop.stop_lon),
      });

      setStationLoading(true);
      setStationError(null);
      setStationRoutes([]);
      setStationExpanded(false);

      try {
        const res = await fetch(`/api/${owner}/stops/resolve?${query}`, {
          ...NO_CACHE_IN_DEV,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const detail: StationDetail = await res.json();
        if (ctrl.signal.aborted) return;

        setStation(detail);
        setStationMode(owner);
        // Cross-system transfers: separate request, optional. The station
        // card must open even if this fails.
        void fetch(
          `/api/nearby?lat=${detail.lat}&lon=${detail.lon}&city=${cityForMode(owner)}`,
          {
            ...NO_CACHE_IN_DEV,
            signal: ctrl.signal,
          },
        )
          .then(async (r) =>
            r.ok ? ((await r.json()) as NearbyStation[]) : [],
          )
          .then((near) => {
            if (ctrl.signal.aborted) return;
            const clicked = {
              mode: owner,
              name: detail.name,
              lat: detail.lat,
              lon: detail.lon,
              routes: detail.routes,
            };
            setConnections(walkingConnections(clicked, near));
            setSamePlace(samePlaceServices(clicked, near));
          })
          .catch(() => {
            // Aborted or offline: the station card simply has no transfers.
          });
        if (owner === "krl" && detail.anchors?.length) {
          const closest = [...detail.anchors].sort(
            (a, b) =>
              Math.hypot(a.lat - stop.stop_lat, a.lon - stop.stop_lon) -
              Math.hypot(b.lat - stop.stop_lat, b.lon - stop.stop_lon),
          )[0];
          setStationAnchor({ lat: closest.lat, lon: closest.lon });
        } else {
          setStationAnchor(null);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error("Failed to load stop:", err);
        setStationError("Gagal memuat halte ini.");
      } finally {
        if (!ctrl.signal.aborted) setStationLoading(false);
      }
    },
    [mode],
  );

  /**
   * "Tampilkan rute di peta": fetch every calling route's geometry, draw
   * them, and open the detailed sidebar panel. This is the expensive half of
   * the old stop-click behaviour, now behind a deliberate action.
   */
  const showStationRoutes = useCallback(async () => {
    if (!station) return;

    const ctrl = new AbortController();
    stationAbortRef.current?.abort();
    stationAbortRef.current = ctrl;

    setStationExpanded(true);
    setStationLoading(true);
    setSelectedKey(null);
    setSheetOpen(true);

    try {
      const results = await Promise.all(
        station.routes.map(async (r) => {
          const g = await fetch(
            `/api/${stationMode}/routes/${encodeURIComponent(r.route_id)}`,
            { ...NO_CACHE_IN_DEV, signal: ctrl.signal },
          );
          if (!g.ok) return null;
          return (await g.json()) as RouteDetail;
        }),
      );
      if (ctrl.signal.aborted) return;
      setStationRoutes(results.filter((r): r is RouteDetail => !!r));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to load station routes:", err);
      setStationError("Gagal memuat rute halte ini.");
    } finally {
      if (!ctrl.signal.aborted) setStationLoading(false);
    }
  }, [station, mode]);

  // A selected route owns its pin layer; the combined all-stops layer would
  // paint every system's stations beneath the selected route's route-stop-pin.
  const showAllStops = isAll
    ? !selectedKey && !station
    : !selectedRouteId && !station;

  /**
   * Fetched on demand: only a visitor who zooms in far enough pays for it.
   * The ref guards against the map firing this on every zoom change.
   */
  // One station layer per dataset, fetched once per view and merged. The
  // all view needs them side by side: rail stations from z9, the bus network
  // (6,437 stops) only once the user zooms in.
  const stopLayers = useRef(new Map<TransitMode, FeatureCollection>());
  const stopsPending = useRef(new Set<TransitMode>());
  const stopGeneration = useRef(0);

  // `isAll` is read inside the async callback below; a ref keeps it current
  // without making the loader itself change identity.
  const isAllRef = useRef(isAll);
  isAllRef.current = isAll;

  const loadStopLayers = useCallback((modes: readonly TransitMode[]) => {
    const generation = stopGeneration.current;
    const wanted = modes.filter(
      (m) => !stopLayers.current.has(m) && !stopsPending.current.has(m),
    );
    if (!wanted.length) return;
    wanted.forEach((m) => stopsPending.current.add(m));

    void Promise.all(
      wanted.map(async (m) => {
        try {
          const res = await fetch(`/api/${m}/stops/geo`, NO_CACHE_IN_DEV);
          if (!res.ok) return;
          stopLayers.current.set(m, (await res.json()) as FeatureCollection);
        } catch {
          // Non-fatal: zooming in simply shows no dots for this mode.
        } finally {
          stopsPending.current.delete(m);
        }
      }),
    ).then(() => {
      // A view switch bumps the generation; a late response must not
      // repopulate the new view with the old view's stations.
      if (generation !== stopGeneration.current) return;
      const parts = [...stopLayers.current.entries()].map(([mode, layer]) => ({
        mode,
        layer,
      }));
      setAllStops(
        (isAllRef.current
          ? mergeStopLayers(parts)
          : (parts[0]?.layer ?? null)) as FeatureCollection | null,
      );
    });
  }, []);

  // Rail layers are small (~28 KB together), so fetch them immediately; the
  // bus layer stays lazy and is requested by the map at its own zoom floor.
  useEffect(() => {
    const rail = viewModes.filter((m) => !isBusMode(m));
    if (rail.length) loadStopLayers(rail);
  }, [viewModes, loadStopLayers]);

  /** The map asks for the rest once it reaches the bus stop floor. */
  const loadAllStops = useCallback(() => {
    loadStopLayers(viewModes);
  }, [loadStopLayers, viewModes]);

  /**
   * Resolve a station clicked on the GPU stop layer. Same path as a marker
   * click, but the layer only carries name + coordinates.
   */
  const handleStationClick = useCallback(
    (name: string, lat: number, lon: number, hitMode?: TransitMode) => {
      void handleStopClick(
        {
          stop_id: "",
          stop_name: name,
          stop_lat: lat,
          stop_lon: lon,
          sequence: 0,
        },
        hitMode,
      );
    },
    [handleStopClick],
  );

  /**
   * A connection was picked: the station card moves to that stop instead,
   * resolved against its own dataset. Same path as clicking it on the map.
   */
  const pickConnection = useCallback(
    (c: NearbyConnection) => {
      handleStationClick(c.name, c.lat, c.lon, c.mode);
    },
    [handleStationClick],
  );

  /**
   * Every operator calling at this stop, this dataset's own first.
   *
   * The card lists them as one station: a separate "other operators" section
   * made them look like a secondary fact when they are simply the rest of the
   * same stop. Operators beyond the first are still resolved against their own
   * dataset when picked.
   */
  const stationOperators = useMemo<StationOperator[]>(() => {
    if (!station) return [];
    const owner = stationMode ?? (isAll ? "gtfs" : (mode as TransitMode));
    return [
      {
        mode: owner,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        routes: station.routes,
      },
      ...samePlace.map((entry) => ({
        mode: entry.mode,
        name: entry.name,
        lat: entry.lat,
        lon: entry.lon,
        routes: entry.routes,
      })),
    ];
  }, [station, stationMode, samePlace, isAll, mode]);

  const clearStation = useCallback(() => {
    stationAbortRef.current?.abort();
    setStation(null);
    setStationMode(null);
    setConnections([]);
    setSamePlace([]);
    setStationAnchor(null);
    setStationRoutes([]);
    setStationError(null);
    setStationLoading(false);
    setStationExpanded(false);
  }, []);

  /**
   * Open a route from the station card, whichever operator runs it.
   *
   * Route ids are only unique inside a mode, so the operator decides the key.
   * If the current view covers a single dataset, switch to the route's dataset
   * first: otherwise the selection would point at a mode the view does not
   * render and the map would stay empty.
   */
  const openRoute = useCallback(
    (operator: TransitMode, routeId: string) => {
      if (!viewModes.includes(operator)) setView(operator);
      clearStation();
      setSelectedKey(routeKey(operator, routeId));
    },
    [viewModes, clearStation],
  );

  /**
   * Clear everything drawn, leaving the camera untouched. With no layers the
   * bounds memo returns null and the fitBounds effect early-returns, so the
   * map holds its current position and zoom.
   */
  const clearSelection = useCallback(() => {
    abortRef.current?.abort();
    setFocusStop(null);
    clearStation();
    setSelectedKey(null);
    setVariantTripId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, [clearStation]);

  // Split the airport hairpin at Duri for display only: both sides terminate
  // on the same passenger pip. Keep baked geometry and timetable unchanged.
  const airportDisplay = useCallback(
    (routeId: string, geometry: DrawnLayer["geometry"]) => {
      if (mode !== "krl" || routeId !== "A") return geometry;
      const airport =
        stationRoutes.find((r) => r.route_id === "A") ??
        (detail?.route_id === "A" ? detail : null) ??
        (hoverDetail?.route_id === "A" ? hoverDetail : null);
      const duriStop = airport?.stops.find((stop) => stop.stop_name === "Duri");
      const manggarai = allStops?.features.find(
        (feature) => feature.properties?.name === "Manggarai",
      );
      const anchors = (manggarai?.properties?.anchors ?? []) as {
        routeId: string;
        lat: number;
        lon: number;
      }[];
      const bogor = anchors.find((a) => a.routeId === "B");
      const cikarang = anchors.find((a) => a.routeId === "C");
      const manggaraiStop = airport?.stops.find(
        (stop) => stop.stop_name === "Manggarai",
      );
      const start: [number, number] | null =
        bogor && cikarang
          ? [(bogor.lon + cikarang.lon) / 2, (bogor.lat + cikarang.lat) / 2]
          : manggaraiStop
            ? [manggaraiStop.stop_lon, manggaraiStop.stop_lat]
            : null;
      if (!duriStop || !start) return geometry;
      return airportDisplayFeatures(
        geometry,
        [duriStop.stop_lon, duriStop.stop_lat],
        start,
        () => true,
      );
    },
    [mode, allStops, stationRoutes, detail, hoverDetail],
  );

  // What the map draws: the station's routes when a stop is open, otherwise
  // the selected route -- either its trunk patterns or one chosen variant.
  const layers: DrawnLayer[] = useMemo(() => {
    if (stationExpanded && station) {
      // Station view draws all trunk directions for each calling route,
      // but not its diversions. This is the unfiltered comparison with
      // the non-overlapping option saved in commit 46a9647.
      return stationRoutes.map((r) => {
        const trunks = (r.variants ?? [])
          .filter(
            (v) =>
              v.kind === "utama" ||
              (mode === "krl" && r.route_id === "B" && v.kind === "alihan"),
          )
          .map((v) => r.geometryByShape?.[v.shape_id])
          .filter((c): c is [number, number][] => Boolean(c?.length));
        const use: [number, number][][] = trunks.length
          ? trunks
          : Object.values(r.geometryByShape ?? {}).filter(
              (c): c is [number, number][] => Boolean(c?.length),
            );

        return {
          id: r.route_id,
          color: r.route_color,
          geometry: airportDisplay(r.route_id, {
            type: "FeatureCollection" as const,
            features: use.map((coordinates) => ({
              type: "Feature" as const,
              properties: {
                shape_id: "",
                lineOffset: railLineOffset(lineMode, r.route_id, coordinates),
              },
              geometry: {
                type: "LineString" as const,
                coordinates,
              },
            })),
          }),
        };
      });
    }
    if (!detail) return [];

    const lineFor = (shapeId: string) => detail.geometryByShape?.[shapeId];

    // Option 4 for comparison: draw each trunk direction's complete GTFS
    // shape. A chosen pattern still draws only its own shape. The lines
    // may overlap where directions share a street; option 1, which removes
    // shared stretches, is saved in commit 46a9647 for easy restoration.
    const lines: [number, number][][] = detail.variants
      .filter((v) =>
        variantTripId
          ? v.trip_id === variantTripId
          : v.kind === "utama" ||
            (mode === "krl" && detail.route_id === "B" && v.kind === "alihan"),
      )
      .map((v) => lineFor(v.shape_id))
      .filter((c): c is [number, number][] => Boolean(c?.length));

    const features = lines.map((coordinates) => ({
      type: "Feature" as const,
      properties: {
        shape_id: "",
        lineOffset: railLineOffset(lineMode, detail.route_id, coordinates),
      },
      geometry: { type: "LineString" as const, coordinates },
    }));

    // A route with no usable variant geometry: draw every shape it has
    // rather than leaving the map blank.
    if (!features.length) {
      const all = Object.values(detail.geometryByShape ?? {})
        .filter((c) => c?.length)
        .map((coordinates) => ({
          type: "Feature" as const,
          properties: {
            shape_id: "",
            lineOffset: railLineOffset(lineMode, detail.route_id, coordinates),
          },
          geometry: { type: "LineString" as const, coordinates },
        }));
      if (!all.length) return [];
      return [
        {
          id: detail.route_id,
          color: detail.route_color,
          geometry: airportDisplay(detail.route_id, {
            type: "FeatureCollection",
            features: all,
          }),
        },
      ];
    }

    return [
      {
        id: `${detail.route_id}:${variantTripId ?? "utama"}`,
        color: detail.route_color,
        geometry: airportDisplay(detail.route_id, {
          type: "FeatureCollection",
          features,
        }),
      },
    ];
  }, [
    stationExpanded,
    stationRoutes,
    detail,
    variantTripId,
    mode,
    airportDisplay,
  ]);

  // The hovered route's trunk line. Line only (no pins), and deliberately
  // separate from `layers`: the map frames `layers` and nothing else, so a
  // preview never moves the camera. Hidden once the route is actually
  // selected and loaded -- the real layer takes over without a gap.
  const previewLayer: DrawnLayer | null = useMemo(() => {
    if (stationExpanded) return null;
    if (!hoverDetail || hoverDetail.route_id !== hoverRouteId) return null;
    if (detail?.route_id === hoverDetail.route_id) return null;

    // Match the selected-route map: preview every complete trunk shape.
    const trunks = (hoverDetail.variants ?? [])
      .filter(
        (v) =>
          v.kind === "utama" ||
          (hoverMode === "krl" &&
            hoverDetail.route_id === "B" &&
            v.kind === "alihan"),
      )
      .map((v) => hoverDetail.geometryByShape?.[v.shape_id])
      .filter((c): c is [number, number][] => Boolean(c?.length));
    const lines: [number, number][][] = trunks.length
      ? trunks
      : Object.values(hoverDetail.geometryByShape ?? {}).filter(
          (c): c is [number, number][] => Boolean(c?.length),
        );

    const features = lines.map((coordinates) => ({
      type: "Feature" as const,
      properties: {
        shape_id: "",
        lineOffset: railLineOffset(
          hoverMode ?? lineMode,
          hoverDetail.route_id,
          coordinates,
        ),
      },
      geometry: { type: "LineString" as const, coordinates },
    }));
    if (!features.length) return null;

    return {
      id: hoverDetail.route_id,
      color: hoverDetail.route_color,
      geometry: airportDisplay(hoverDetail.route_id, {
        type: "FeatureCollection",
        features,
      }),
    };
  }, [
    stationExpanded,
    hoverDetail,
    hoverRouteId,
    hoverMode,
    detail,
    mode,
    airportDisplay,
  ]);

  // Stops shown as pins.
  const visibleStops: RouteStop[] = useMemo(() => {
    // A selected stop is the point of interest, and replaces the city-wide
    // dot with the larger active route-stop pin however it was opened
    // (route, search, or all-stops layer).
    if (station) {
      const selected: RouteStop = {
        stop_id: station.id,
        stop_name: station.name,
        stop_lat: station.lat,
        stop_lon: station.lon,
        sequence: 0,
      };
      // Before "Tampilkan rute di peta" only the selected stop is shown.
      if (!stationExpanded) return [selected];

      // After it, add the stops of each drawn route -- and only those.
      // The lines are the trunk patterns, so the pins use the same
      // patterns' stops rather than every stop a diversion might add.
      // The selected stop goes first so it stays the cluster's
      // representative; clusterStops then folds the platforms and the
      // stops shared between routes into one pin each.
      const seen = new Set<string>([selected.stop_id]);
      const out: RouteStop[] = [selected];
      for (const r of stationRoutes) {
        const trunk = (r.variants ?? []).filter(
          (v) =>
            v.kind === "utama" ||
            (mode === "krl" && r.route_id === "B" && v.kind === "alihan"),
        );
        const allow = trunk.length
          ? new Set(trunk.flatMap((v) => v.stopIds))
          : null;
        for (const s of r.stops) {
          if (allow && !allow.has(s.stop_id)) continue;
          if (seen.has(s.stop_id)) continue;
          seen.add(s.stop_id);
          out.push(s);
        }
      }
      return out;
    }
    if (!detail) return [];

    // A selected route keeps only the stops belonging to the pattern that
    // is actually drawn, so a diversion does not show stops it never
    // calls at. The separate city-wide all-stops layer is hidden below.
    const v = variantTripId
      ? detail.variants.find((x) => x.trip_id === variantTripId)
      : null;
    if (v) {
      const allow = new Set(v.stopIds);
      const only = detail.stops.filter((s) => allow.has(s.stop_id));
      if (only.length) return only;
    }
    return detail.stops;
  }, [station, stationExpanded, stationRoutes, detail, variantTripId]);

  // The two terminals of the previewed route: first and last stop of the
  // line being drawn. Intermediates are left out on purpose -- the preview
  // answers "where does this go?", not "where does it stop?".
  const previewEnds: RouteStop[] = useMemo(() => {
    if (!previewLayer || !hoverDetail) return [];

    const trunk = (hoverDetail.variants ?? []).find((v) => v.kind === "utama");
    const byId = new Map(hoverDetail.stops.map((s) => [s.stop_id, s]));

    // The stops in the order the drawn line visits them. A loop returns to
    // where it began, so first/last alone would give one pin for a route
    // with two ends; routeTerminals uses the long name to find the far one.
    const ordered: RouteStop[] = trunk?.stopIds.length
      ? trunk.stopIds
          .map((id) => byId.get(id))
          .filter((s): s is RouteStop => !!s)
      : [...hoverDetail.stops].sort((x, y) => x.sequence - y.sequence);
    const ends: (RouteStop | undefined)[] = routeTerminals(
      hoverDetail.route_long_name,
      ordered,
    );

    const seen = new Set<string>();
    return ends.filter((s): s is RouteStop => {
      if (!s || seen.has(s.stop_id)) return false;
      seen.add(s.stop_id);
      return true;
    });
  }, [previewLayer, hoverDetail]);

  // What the map pins: the open route/stop, plus the previewed terminals.
  const pinStops: RouteStop[] = useMemo(() => {
    if (station || !previewEnds.length) return visibleStops;
    const have = new Set(visibleStops.map((s) => s.stop_id));
    return [
      ...visibleStops,
      ...previewEnds.filter((s) => !have.has(s.stop_id)),
    ];
  }, [station, visibleStops, previewEnds]);

  // Stop-name search. Debounced so typing does not fire a request per key.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setStopHits([]);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        // One query per dataset in view; each hit remembers its mode so
        // opening it resolves against the right dataset.
        const lists = await Promise.all(
          viewModes.map(async (m) => {
            const res = await fetch(
              `/api/${m}/search?q=${encodeURIComponent(q)}`,
              { ...NO_CACHE_IN_DEV, signal: ctrl.signal },
            );
            if (!res.ok) return [];
            return ((await res.json()) as StationSearchHit[]).map(
              (hit): ModeStopHit => ({ ...hit, mode: m }),
            );
          }),
        );
        // One hit per PLACE: the same terminal is a separate stop in each
        // operator's dataset, which showed up as the same name two or three
        // times in the list. Keep the entry with the most routes, and merge
        // the route count so the "N rute" figure spans operators.
        const flat = lists.flat();
        const merged: ModeStopHit[] = [];
        for (const hit of flat.sort((a, b) => b.routeCount - a.routeCount)) {
          const twin = merged.find(
            (kept) =>
              kept.name === hit.name &&
              Math.hypot(
                (kept.lon - hit.lon) * 111_320 * Math.cos(((kept.lat + hit.lat) * Math.PI) / 360),
                (kept.lat - hit.lat) * 110_540,
              ) <= 40,
          );
          if (twin) {
            twin.routeCount = Math.max(twin.routeCount, hit.routeCount);
            continue;
          }
          merged.push({ ...hit });
        }
        if (!ctrl.signal.aborted) setStopHits(merged);
      } catch {
        // Aborted or offline: routes still filter locally.
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [searchQuery, viewModes]);

  // Derived state belongs in useMemo, not in a useEffect + setState pair.
  const filteredRoutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(
      ({ route }) =>
        route.route_long_name.toLowerCase().includes(q) ||
        route.route_short_name.toLowerCase().includes(q),
    );
  }, [routes, searchQuery]);

  // One heading per mode in the all view; a single mode needs no heading.
  const routeGroups = useMemo(
    () => groupRoutesByMode(filteredRoutes),
    [filteredRoutes],
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col md:flex-row">
      {/*
              Mobile: the sidebar is a bottom sheet over the map, collapsed to
              a peek by default and expandable. Desktop (md+): the original
              fixed 384px column. One DOM tree, no duplicated markup.
            */}
      {/*
              Tailwind scans source text for complete class strings, so these
              must stay on one line -- a multi-line template literal splits
              them across newlines and they are never generated.
            */}
      <aside
        className={`order-2 flex w-full shrink-0 flex-col rounded-t-2xl bg-jakarta text-white transition-[height] duration-300 ease-out md:order-1 md:h-full md:w-96 md:rounded-none lg:w-80 md:transition-none ${
          sheetOpen ? "h-[70%]" : "h-[42%]"
        }`}
      >
        {/* Drag affordance + expand toggle: mobile only. */}
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          aria-label={
            sheetOpen ? "Perkecil daftar rute" : "Perbesar daftar rute"
          }
          className="flex w-full shrink-0 items-center justify-center py-2 md:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-white/30" />
        </button>

        <div className="hidden items-center p-4 text-xl font-bold font-pt-sans md:flex">
          <Link href={"/"}>Transum App - {modeLabel(view)}</Link>
        </div>
        <Separator className="hidden md:block" />
        <div className="flex w-full flex-col px-4 pb-3 pt-1 md:p-4">
          <Select
            value={view}
            onValueChange={(val) => {
              const next = parseView(val);
              if (next) switchView(next);
            }}
          >
            <SelectTrigger className="w-full border-white/20 bg-white/10 text-white [&>svg]:opacity-70">
              <SelectValue placeholder="Pilih moda" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="pl-4">Jakarta</SelectLabel>
                {/* Every dataset on one map: rail lines bold, the bus
                    network faint underneath. First in the group because it
                    covers everything under it. */}
                <SelectItem value="all">Semua Moda</SelectItem>
                {MODES.filter((m) =>
                  cityModes("jakarta").includes(m.value),
                ).map((m) => (
                  <SelectItem key={m.value} value={m.value} disabled={!m.ready}>
                    {m.label}
                    {!m.ready && " (segera)"}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="pl-4">Bandung</SelectLabel>
                <SelectItem value="bandung-all">Semua Moda</SelectItem>
                {MODES.filter((m) =>
                  cityModes("bandung").includes(m.value),
                ).map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <Separator className="hidden md:block" />
        <div className="flex w-full grow flex-col overflow-hidden">
          <div className="px-4 pb-3 md:p-4">
            {/*
                          The sidebar is always dark navy, so the input cannot
                          inherit the themed background/foreground -- in dark
                          mode that rendered near-black text on a near-black
                          field. Pin it to the sidebar's own palette instead.
                        */}
            <div className="relative">
              <Input
                placeholder="Cari rute atau halte"
                aria-label="Cari rute atau halte"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchQuery("");
                }}
                className="border-white/20 bg-white/10 pr-9 text-white placeholder:text-white/50 focus-visible:ring-white/40 focus-visible:ring-offset-jakarta"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Hapus pencarian"
                  title="Hapus pencarian"
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pl-4 pr-4 pb-4">
            {stationExpanded && station && (
              <StopPanel
                station={station}
                loading={stationLoading}
                error={stationError}
                connections={connections}
                operators={stationOperators}
                onPickConnection={pickConnection}
                onBack={clearStation}
                onPickRoute={openRoute}
              />
            )}

            {/* Matching stops, above the matching routes. */}
            {!stationExpanded && stopHits.length > 0 && (
              <div className="-ml-4 -mr-4 mb-2">
                <div className="px-4 pb-1 text-xs font-bold tracking-wide text-white/40 uppercase">
                  Halte
                </div>
                {stopHits.map((s) => (
                  <button
                    key={`${s.mode}:${s.name}@${s.lat},${s.lon}`}
                    type="button"
                    onClick={() => {
                      handleStationClick(s.name, s.lat, s.lon, s.mode);
                      setSheetOpen(false);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 p-2 pr-4 pl-4 text-left text-white transition-colors hover:bg-white/10"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <MapPin size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-pt-sans">{s.name}</div>
                      <div className="text-xs text-white/50">
                        {s.routeCount} rute
                      </div>
                    </div>
                  </button>
                ))}
                {filteredRoutes.length > 0 && (
                  <div className="mt-2 px-4 pb-1 text-xs font-bold tracking-wide text-white/40 uppercase">
                    Rute
                  </div>
                )}
              </div>
            )}

            {!stationExpanded && routesLoading && <RouteListSkeleton />}

            {routesError && (
              <div className="text-sm text-red-200 bg-red-900/40 rounded p-3">
                {routesError}
              </div>
            )}

            {!stationExpanded &&
              !routesLoading &&
              !routesError &&
              filteredRoutes.length === 0 &&
              stopHits.length === 0 && (
                <div className="text-sm text-white/60 p-2">
                  Tidak ada rute atau halte yang cocok dengan &quot;
                  {searchQuery}&quot;.
                </div>
              )}

            {!isWide && !station && detail && (
              <div className="-mr-4 -ml-4 mb-3 border-b border-white/10 pb-2">
                <VariantPanel
                  detail={detail}
                  mode={mode ?? undefined}
                  selected={variantTripId}
                  onSelect={setVariantTripId}
                  onClear={clearSelection}
                  onStop={focusStopAt}
                  focusedStopId={focusStop?.stop_id ?? null}
                  embedded
                />
              </div>
            )}

            {!stationExpanded &&
              !routesLoading &&
              routeGroups.map((group) => (
                <div key={group.mode}>
                  {isAll && (
                    <div className="-ml-4 mb-1 px-4 pt-2 text-xs font-bold tracking-wide text-white/40 uppercase">
                      {modeLabel(group.mode)}
                    </div>
                  )}
                  {group.routes.map(({ mode: routeMode, route: r }) => {
                    const key = routeKey(routeMode, r.route_id);
                    const isSelected = selectedKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={isSelected}
                        // Mouse only: on touch, the emulated
                        // hover would flash a preview right
                        // before the tap selects the route.
                        onPointerEnter={(e) => {
                          if (e.pointerType === "mouse") setHoverKey(key);
                        }}
                        onPointerLeave={() => setHoverKey(null)}
                        className={`-ml-4 -mr-4 flex w-[calc(100%+2rem)] cursor-pointer items-center gap-2 p-2 pl-4 pr-4 text-left text-white transition-colors ${
                          isSelected
                            ? "bg-jakarta-selected hover:brightness-110"
                            : // `bg-opacity-*` was removed in Tailwind v4, so the
                              // old `hover:bg-white hover:bg-opacity-10` rendered
                              // as solid white -- white text on white. Use the
                              // slash-opacity syntax instead.
                              "hover:bg-white/10"
                        }`}
                        onClick={() => {
                          clearStation();
                          setSelectedKey(isSelected ? null : key);
                          // Give the map room once a route is
                          // picked; no-op on desktop.
                          if (!isSelected) setSheetOpen(false);
                        }}
                      >
                        <div
                          className="flex shrink-0 w-10 h-10 text-sm font-bold font-pt-sans-narrow rounded-full items-center justify-center"
                          style={{
                            backgroundColor: `#${r.route_color}`,
                            color:
                              calculateLuminance(r.route_color) > 0.5
                                ? "black"
                                : "white",
                          }}
                        >
                          {r.route_short_name}
                        </div>
                        <div className="flex-1 font-pt-sans">
                          {r.route_long_name}
                        </div>
                        {isSelected && detailLoading && (
                          <span className="w-3 h-3 shrink-0 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
          </div>

          {detailError && (
            <div className="text-sm text-red-200 bg-red-900/40 m-4 rounded p-3">
              {detailError}
            </div>
          )}
        </div>
      </aside>

      {/*
              min-w-0 + flex-1 is load-bearing. With `w-full md:flex-none` the
              map kept a full-viewport width *next to* the 384px sidebar, so it
              overflowed by exactly that much and its centre sat ~192px right
              of the visible area -- about 29 km west at zoom 10, which put
              Tangerang in the middle of the screen instead of Jakarta.
            */}
      <div className="relative order-1 min-h-0 w-full min-w-0 flex-1 md:order-2 md:h-full">
        {/* Floating over the map rather than in the sidebar: it is
                    about the thing being drawn, so it belongs next to it.
                    Hidden while a stop popup is open so the two cards never
                    compete for the same corner. */}
        {isWide && !station && detail && (
          <div
            ref={cardRef}
            className="pointer-events-auto absolute top-3 bottom-3 left-3 z-20 flex flex-col items-start"
          >
            <VariantPanel
              detail={detail}
              mode={mode ?? undefined}
              selected={variantTripId}
              onSelect={setVariantTripId}
              onClear={clearSelection}
              onStop={focusStopAt}
              focusedStopId={focusStop?.stop_id ?? null}
            />
          </div>
        )}

        <MainMapComponent
          layers={layers}
          previewLayer={previewLayer}
          connections={connections}
          leftInset={
            // The larger of the two: the measurement lags a
            // route switch (it still holds the previous card's
            // width when fitBounds runs), and over-padding by a
            // few px is harmless where under-padding hides route.
            cardShown ? Math.max(cardWidth, expectedCardWidth) + 12 : 0
          }
          focusPoint={
            focusStop
              ? {
                  lat: focusStop.stop_lat,
                  lon: focusStop.stop_lon,
                  name: removeOppStopPrefix(focusStop.stop_name),
                  seq: focusStop.seq,
                }
              : null
          }
          // Keyed on the hover itself, not on the loaded preview:
          // the route takes a moment to arrive and the network
          // must already be gone, or it flashes back in between.
          hideOverview={!!hoverRouteId && !stationExpanded}
          // The all view follows the rail display rules (station floor,
          // interchanges, the airport marker); `allModes` switches the overview
          // to bus-faint / rail-bold styling.
          mode={
            isAll ? (view === "all" ? "krl" : "bdg-kci") : (view as TransitMode)
          }
          allModes={isAll}
          forcePins={previewEnds.length > 0}
          routeStops={pinStops}
          overview={overview}
          overviewFitRequest={overviewFitRequest}
          allStops={allStops}
          showAllStops={showAllStops}
          onStationClick={handleStationClick}
          onNeedAllStops={loadAllStops}
          stopPopup={
            station ? (
              <StopPopupCard
                station={station}
                loading={stationLoading}
                error={stationError}
                expanded={stationExpanded}
                connections={connections}
                operators={stationOperators}
                onShowRoutes={showStationRoutes}
                onClose={clearStation}
                onPickConnection={pickConnection}
                onPickRoute={openRoute}
              />
            ) : null
          }
          activeStop={
            station
              ? {
                  lat: stationAnchor?.lat ?? station.lat,
                  lon: stationAnchor?.lon ?? station.lon,
                  name: station.name,
                }
              : null
          }
          onStopClick={(stop) => handleStopClick(stop, mode ?? undefined)}
          // Clicking empty map closes the open stop. Only the
          // station is cleared, not the route behind it, so the
          // user drops back to the route they were exploring
          // rather than to a blank map.
          onBackgroundClick={station ? clearStation : undefined}
        />
      </div>
    </div>
  );
}

/**
 * Pattern picker for the selected route.
 *
 * Transjakarta files every pattern under one route_id, so "route 1" is really
 * 18 trips. Only the trunk is treated as the normal service; every diversion
 * is opt-in, because GTFS Static cannot say which one is running today.
 */
function VariantPanel({
  detail,
  mode,
  selected,
  onSelect,
  onClear,
  onStop,
  focusedStopId,
  embedded = false,
}: {
  detail: RouteDetail;
  mode?: TransitMode;
  selected: string | null;
  onSelect: (tripId: string | null) => void;
  /** Clears the whole route selection; rendered in this panel's header. */
  onClear: () => void;
  /** A stop name was clicked: focus the map on it (no popup). */
  onStop: (stop: RouteStop) => void;
  focusedStopId?: string | null;
  /**
   * Rendered inside the sidebar (narrow screens) rather than floating over
   * the map: no card chrome, and the sidebar is what scrolls.
   */
  embedded?: boolean;
}) {
  const [showOther, setShowOther] = useState(false);
  // Collapsed by default: the stop diagram is what most people want, and
  // the pattern picker is one click away.
  const [collapsed, setCollapsed] = useState(true);
  const [stopsOpen, setStopsOpen] = useState(true);
  // Which main direction the stop list follows. Tagged with the route so it
  // resets on its own when another route is picked, without an effect.
  const [trunkSel, setTrunkSel] = useState({ rid: "", i: 0 });

  const variants = detail.variants ?? [];
  const trunks = variants.filter((v) => v.kind === "utama");
  // Cikarang's two main rackets each visit Cikarang twice, with a city loop
  // between. They are not an outward/return pair: aligning them on two rails
  // would duplicate Jatinegara and imply stops in the wrong direction.
  const circuit =
    mode === "krl" &&
    detail.route_id === "C" &&
    trunks.some(
      (v) =>
        v.stopIds.length > 2 &&
        v.stopIds[0] === v.stopIds[v.stopIds.length - 1],
    );
  const trunkIdx =
    trunkSel.rid === detail.route_id
      ? Math.min(trunkSel.i, Math.max(trunks.length - 1, 0))
      : 0;
  // The pattern the map is drawing: the chosen variant, else a main one.
  const shown =
    (selected && variants.find((v) => v.trip_id === selected)) ||
    trunks[trunkIdx] ||
    variants[0];

  // Both directions side by side when they mirror each other. Each
  // Cikarang racket is itself a complete loop and must remain an ordered
  // single line. Selecting either main pattern also shows just that line.
  const dual = useMemo(
    () => (selected || circuit ? null : dualDiagramFor(detail)),
    [detail, selected, circuit],
  );
  const lineStops = useMemo(
    () => (shown ? singleDiagramFor(detail, shown).stops : []),
    [detail, shown],
  );
  const stopCount = dual ? dual.rows.length : lineStops.length;
  const color = "#" + detail.route_color;

  // Rendered even for a single pattern (40 of 240 routes): the card carries
  // the only clear-selection control, and the pattern list simply collapses
  // to one row.
  if (!variants.length) return null;

  const diversions = variants.filter((v) => v.kind === "alihan");
  const others = variants.filter(
    (v) => v.kind === "pendek" || v.kind === "putaran",
  );

  const dirLabel = (d: string) => (d === "0" ? "\u2192" : "\u2190");

  const Row = ({
    id,
    active,
    title,
    sub,
    onClick,
  }: {
    id: string;
    active: boolean;
    title: string;
    sub: string;
    onClick: () => void;
  }) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left transition-colors ${
        active ? "bg-white/15" : "hover:bg-white/10"
      }`}
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? "bg-white" : "bg-white/30"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-pt-sans">{title}</span>
        <span className="block text-[11px] text-white/50">{sub}</span>
      </span>
    </button>
  );

  const activeLabel = selected
    ? (() => {
        const v = variants.find((x) => x.trip_id === selected);
        return v ? (v.via ? `via ${v.via}` : v.headsign) : "Utama";
      })()
    : circuit
      ? "Kedua arah putaran"
      : "Utama";

  return (
    <div
      className={
        embedded
          ? "flex flex-col text-white"
          : // Two names per row need ~380px; one needs far less.
            // Measured by the page, so fitBounds follows either.
            `flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg bg-jakarta/95 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-sm ${
              dual && stopsOpen ? "w-96" : "w-72"
            }`
      }
    >
      {/*
              Which route this panel belongs to. Without it the card showed
              only pattern names, so it was not obvious what was being
              configured once the sidebar scrolled away from the selection.
            */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold font-pt-sans-narrow"
          style={{
            backgroundColor: `#${detail.route_color}`,
            color:
              calculateLuminance(detail.route_color) > 0.5 ? "black" : "white",
          }}
        >
          {detail.route_short_name}
        </span>
        <span
          className="min-w-0 flex-1 text-xs leading-snug font-bold font-pt-sans"
          title={detail.route_long_name}
        >
          {detail.route_long_name}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Bersihkan pilihan"
          title="Bersihkan pilihan"
          className="-mr-1 shrink-0 cursor-pointer rounded p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mx-3 shrink-0 border-t border-white/10" />

      {/* One scroll area for everything under the header: the pattern
                picker and the stop line together can be far taller than the
                card, and nested scrollers would trap the wheel. */}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-y-auto"}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
        >
          <Route size={13} className="shrink-0 opacity-60" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold tracking-wide text-white/40 uppercase">
              Pola perjalanan
            </span>
            {collapsed && (
              <span className="block truncate text-xs">{activeLabel}</span>
            )}
          </span>
          <ChevronRight
            size={14}
            className={`shrink-0 opacity-60 transition-transform ${
              collapsed ? "" : "rotate-90"
            }`}
          />
        </button>

        {!collapsed && (
          <div className="pb-1">
            {circuit && (
              <Row
                id="C-all"
                active={selected === null}
                title="Kedua arah putaran"
                sub="Tampilkan kedua jalur di peta"
                onClick={() => onSelect(null)}
              />
            )}

            {variants
              .filter((v) => v.kind === "utama")
              .map((v) => (
                <Row
                  key={v.trip_id}
                  id={v.trip_id}
                  active={circuit ? selected === v.trip_id : selected === null}
                  title={
                    circuit
                      ? `Putaran via ${v.via ?? v.headsign}`
                      : `Utama ${dirLabel(v.direction_id)} ${v.headsign}`
                  }
                  sub={`${v.stopCount} ${mode === "krl" || mode === "bdg-kci" || mode === "bdg-kai" ? "pemberhentian" : "halte"}${
                    v.headwaySecs
                      ? ` \u00b7 tiap ${Math.round(v.headwaySecs / 60)} mnt`
                      : ""
                  }`}
                  onClick={() => onSelect(circuit ? v.trip_id : null)}
                />
              ))}

            {diversions.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-wide text-white/40 uppercase">
                  Jalur alternatif
                </div>
                {diversions.map((v) => (
                  <Row
                    key={v.trip_id}
                    id={v.trip_id}
                    active={selected === v.trip_id}
                    title={`${dirLabel(v.direction_id)} ${
                      v.via ? `via ${v.via}` : v.headsign
                    }`}
                    sub={`${v.stopCount} halte${
                      v.extraStops.length
                        ? ` \u00b7 +${v.extraStops.length} halte lain`
                        : ""
                    }`}
                    onClick={() =>
                      onSelect(selected === v.trip_id ? null : v.trip_id)
                    }
                  />
                ))}
              </>
            )}

            {others.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowOther((s) => !s)}
                  aria-expanded={showOther}
                  className="mt-1 flex w-full items-center gap-1 px-3 py-1.5 text-[11px] text-white/50 hover:text-white/80"
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${showOther ? "rotate-90" : ""}`}
                  />
                  Layanan pendek &amp; putaran ({others.length})
                </button>
                {showOther &&
                  others.map((v) => (
                    <Row
                      key={v.trip_id}
                      id={v.trip_id}
                      active={selected === v.trip_id}
                      title={`${dirLabel(v.direction_id)} ${v.headsign}`}
                      sub={`${
                        v.kind === "putaran" ? "Putaran" : "Pendek"
                      } \u00b7 ${v.stopCount} halte`}
                      onClick={() =>
                        onSelect(selected === v.trip_id ? null : v.trip_id)
                      }
                    />
                  ))}
              </>
            )}
          </div>
        )}

        {!collapsed && (
          <p className="px-3 pt-1 pb-2.5 text-[10px] leading-snug text-white/35">
            {mode === "krl" && detail.route_id === "C"
              ? "Pola dari OpenStreetMap; tidak ada jadwal kereta dalam data ini."
              : mode?.startsWith("bdg-")
                ? "Rute dari OpenStreetMap; tidak ada jadwal atau frekuensi dalam data ini."
                : "Hanya tampil bila dipilih. GTFS tidak mencatat pengalihan yang sedang berlaku."}
          </p>
        )}

        <div className="mx-3 border-t border-white/10" />

        <button
          type="button"
          onClick={() => setStopsOpen((o) => !o)}
          aria-expanded={stopsOpen}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
        >
          <MapPin size={13} className="shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 text-[10px] font-bold tracking-wide text-white/40 uppercase">
            {mode === "krl" || mode === "bdg-kci" || mode === "bdg-kai"
              ? "Pemberhentian"
              : "Halte"}
            {stopCount > 0 ? " \u00b7 " + stopCount : ""}
          </span>
          <ChevronRight
            size={14}
            className={`shrink-0 opacity-60 transition-transform ${
              stopsOpen ? "rotate-90" : ""
            }`}
          />
        </button>

        {stopsOpen && (
          <div className="pb-3">
            {/* Two main directions: let the list follow either. Only
                        while no specific pattern is picked -- a picked
                        pattern is one direction already. */}
            {!dual && !selected && trunks.length > 1 && (
              <div className="grid grid-cols-2 gap-1 px-3 pb-2">
                {trunks.map((v, i) => (
                  <button
                    key={v.trip_id}
                    type="button"
                    aria-pressed={i === trunkIdx}
                    title={v.headsign}
                    onClick={() =>
                      setTrunkSel({
                        rid: detail.route_id,
                        i,
                      })
                    }
                    className={`cursor-pointer truncate rounded px-2 py-1 text-[11px] font-pt-sans transition-colors ${
                      i === trunkIdx
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:bg-white/10"
                    }`}
                  >
                    {circuit
                      ? `via ${v.via ?? v.headsign}`
                      : `${dirLabel(v.direction_id)} ${v.headsign}`}
                  </button>
                ))}
              </div>
            )}
            {(selected || circuit) && shown && (
              <div className="truncate px-3 pb-2 text-[11px] text-white/50">
                {circuit ? "Pola: " : dirLabel(shown.direction_id) + " "}
                {shown.via ? "via " + shown.via : shown.headsign}
              </div>
            )}

            {dual ? (
              <DualLine
                diagram={dual}
                color={color}
                onStop={onStop}
                focusedId={focusedStopId}
              />
            ) : (
              <SingleLine
                stops={lineStops}
                color={color}
                onStop={onStop}
                focusedId={focusedStopId}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Replaces the route list while a stop is open: the station name and every
 * route calling there, each clickable to switch back to single-route view.
 */
/**
 * Compact station card shown in a popup anchored to the clicked stop.
 *
 * Deliberately shows only identity -- name, platforms, route badges -- and
 * defers drawing the routes to an explicit button: a busy interchange serves
 * up to 14 routes, and fetching every geometry on each click cost ~294 KB for
 * what is usually just "what is this stop?".
 */
function StopPopupCard({
  station,
  loading,
  error,
  expanded,
  connections,
  operators,
  onShowRoutes,
  onClose,
  onPickConnection,
  onPickRoute,
}: {
  station: StationDetail;
  loading: boolean;
  error: string | null;
  expanded: boolean;
  connections: NearbyConnection[];
  operators: StationOperator[];
  onShowRoutes: () => void;
  onClose: () => void;
  onPickConnection: (c: NearbyConnection) => void;
  /** Open a route, whichever operator runs it. */
  onPickRoute: (mode: TransitMode, routeId: string) => void;
}) {
  return (
    <div className="w-56 overflow-hidden rounded-lg bg-jakarta text-white shadow-xl ring-1 ring-white/10">
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <MapPin size={13} className="mt-0.5 shrink-0 opacity-60" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-tight font-bold font-pt-sans">
            {station.name}
          </h2>
          <p className="mt-0.5 text-[11px] text-white/50">
            {operators.reduce((n, operator) => n + operator.routes.length, 0)}{" "}
            rute
            {operators.length > 1 && ` \u00b7 ${operators.length} operator`}
            {station.platforms > 1 && ` \u00b7 ${station.platforms} peron`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="-mt-0.5 -mr-1 shrink-0 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      {operators.some((operator) => operator.routes.length > 0) && (
        <div className="space-y-1 px-3 pb-2.5">
          {operators.map((operator) => {
            const chips = (
              <div className="flex flex-wrap gap-1">
                {operator.routes.map((r) => (
                  <button
                    key={r.route_id}
                    type="button"
                    onClick={() => onPickRoute(operator.mode, r.route_id)}
                    title={`${r.route_long_name} \u00b7 ${modeLabel(operator.mode)}`}
                    className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] leading-none font-bold font-pt-sans-narrow transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: `#${r.route_color}`,
                      color:
                        calculateLuminance(r.route_color) > 0.5
                          ? "black"
                          : "white",
                    }}
                  >
                    {r.route_short_name}
                  </button>
                ))}
              </div>
            );
            // A single operator needs no label. Once the stop is shared, EVERY
            // operator is named -- including the station's own dataset, which
            // otherwise looked unlabelled next to the other two. `items-center`
            // keeps the chips level with the name when it wraps.
            if (operators.length === 1) {
              return <div key={operator.mode}>{chips}</div>;
            }
            return (
              <div
                key={operator.mode}
                className="flex w-full items-center gap-1.5 px-0.5"
              >
                <span className="w-[72px] shrink-0 text-[9px] leading-tight text-white/40">
                  {modeLabel(operator.mode)}
                </span>
                <span className="min-w-0 flex-1">{chips}</span>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mx-3 mb-2 rounded bg-red-900/40 p-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      <ConnectionList
        connections={connections}
        onPick={onPickConnection}
        compact
      />

      <button
        type="button"
        onClick={onShowRoutes}
        disabled={loading || expanded || station.routes.length === 0}
        className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-[11px] font-bold transition-colors hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <Route size={12} />
        {loading
          ? "Memuat\u2026"
          : expanded
            ? "Rute ditampilkan"
            : "Tampilkan rute di peta"}
      </button>
    </div>
  );
}

function StopPanel({
  station,
  loading,
  error,
  connections,
  operators,
  onBack,
  onPickRoute,
  onPickConnection,
}: {
  station: StationDetail;
  loading: boolean;
  error: string | null;
  connections: NearbyConnection[];
  operators: StationOperator[];
  onBack: () => void;
  onPickRoute: (mode: TransitMode, routeId: string) => void;
  onPickConnection: (c: NearbyConnection) => void;
}) {
  return (
    <div className="-ml-4 -mr-4">
      <div className="flex items-start gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Kembali ke daftar rute"
          className="mt-0.5 shrink-0 rounded p-1 hover:bg-white/10"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-white/60">
            <MapPin size={12} />
            Halte
            {station.platforms > 1 && ` \u00b7 ${station.platforms} peron`}
          </div>
          <h2 className="text-lg leading-tight font-bold font-pt-sans">
            {station.name}
          </h2>
          <p className="mt-0.5 text-xs text-white/60">
            {operators.reduce((n, operator) => n + operator.routes.length, 0)}{" "}
            rute berhenti di sini
            {loading && " \u00b7 memuat peta\u2026"}
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-4 rounded bg-red-900/40 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <Separator className="opacity-20" />

      {operators.map((operator, index) => (
        <div key={operator.mode}>
          {operators.length > 1 && (
            <div className="px-4 pt-2 pb-1 text-[10px] font-bold tracking-wide text-white/40 uppercase">
              {modeLabel(operator.mode)}
            </div>
          )}
          {operator.routes.map((r) => (
            <button
              key={r.route_id}
              type="button"
              onClick={() => onPickRoute(operator.mode, r.route_id)}
              className="flex w-full cursor-pointer items-center gap-2 p-2 pr-4 pl-4 text-left text-white transition-colors hover:bg-white/10"
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold font-pt-sans-narrow"
                style={{
                  backgroundColor: `#${r.route_color}`,
                  color:
                    calculateLuminance(r.route_color) > 0.5 ? "black" : "white",
                }}
              >
                {r.route_short_name}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-pt-sans">{r.route_long_name}</div>
                {index === 0 && r.position && r.totalStops && (
                  <div className="text-xs text-white/50">
                    Halte ke-{r.position} dari {r.totalStops}
                    {r.position === 1 && " \u00b7 awal"}
                    {r.position === r.totalStops && " \u00b7 akhir"}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      ))}
      <ConnectionList connections={connections} onPick={onPickConnection} />
    </div>
  );
}

/**
 * "Koneksi sekitar": stops of another service within a short walk, the
 * transfers this station opens up. Each row names the system and the routes
 * it uniquely contributes, so the list is "where can I change?" rather than
 * "what else is nearby?" (see utils/nearby.ts for the rule).
 *
 * `compact` fits the map popup: fewer rows, no divider headers.
 */
function ConnectionList({
  connections,
  onPick,
  compact = false,
}: {
  connections: NearbyConnection[];
  onPick: (c: NearbyConnection) => void;
  compact?: boolean;
}) {
  /**
   * Hovered row's hidden routes, shown as a real floating tooltip.
   *
   * It is portalled to `document.body` and positioned `fixed` from the row's
   * rect: the station card clips its own overflow, so an absolutely positioned
   * child would be cut off at the card edge. A portal is the only way to float
   * above everything without changing the card's clipping.
   */
  const [tip, setTip] = useState<{
    key: string;
    name: string;
    routes: NearbyConnection["routes"];
    left: number;
    top: number;
    above: boolean;
  } | null>(null);

  // The card can be replaced by another station while a tooltip is open.
  useEffect(() => setTip(null), [connections]);

  if (!connections.length) return null;
  const shown = compact ? connections.slice(0, 5) : connections;
  const limit = compact ? 2 : 3;
  const TIP_WIDTH = 232;

  const openTip = (key: string, name: string, routes: NearbyConnection["routes"], el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const above = box.top > 150;
    const left = Math.min(
      Math.max(8, box.left),
      Math.max(8, window.innerWidth - TIP_WIDTH - 8),
    );
    setTip({
      key,
      name,
      routes,
      left,
      top: above ? box.top - 6 : box.bottom + 6,
      above,
    });
  };

  return (
    <div className="border-t border-white/10">
      <div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-wide text-white/40 uppercase">
        Koneksi sekitar
        {compact && connections.length > shown.length && (
          <span className="ml-1 text-white/30 normal-case">
            ({connections.length - shown.length} lainnya di panel)
          </span>
        )}
      </div>
      {shown.map((c) => {
        const key = `${c.mode}:${c.name}@${c.lat},${c.lon}`;
        const { shown: badges, hidden } = connectionRoutes(c.routes, limit);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(c)}
            onPointerEnter={(e) => {
              // Mouse only: on touch the emulated hover would flash a tooltip
              // under the finger before the tap lands.
              if (e.pointerType === "mouse" && hidden.length) {
                openTip(key, c.name, hidden, e.currentTarget);
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") {
                setTip((prev) => (prev?.key === key ? null : prev));
              }
            }}
            onFocus={(e) => {
              if (hidden.length) openTip(key, c.name, hidden, e.currentTarget);
            }}
            onBlur={() => setTip((prev) => (prev?.key === key ? null : prev))}
            aria-describedby={hidden.length ? `conn-tip-${key}` : undefined}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/10"
          >
            <div className="flex shrink-0 items-center gap-1">
              {badges.map((r) => (
                <span
                  key={r.route_id}
                  title={`${r.route_short_name} · ${r.route_long_name}`}
                  className="rounded px-1 py-0.5 text-[9px] leading-none font-bold font-pt-sans-narrow"
                  style={{
                    backgroundColor: `#${r.route_color}`,
                    color:
                      calculateLuminance(r.route_color) > 0.5
                        ? "black"
                        : "white",
                  }}
                >
                  {r.route_short_name}
                </span>
              ))}
              {hidden.length > 0 && (
                <span className="text-[9px] text-white/40">
                  +{hidden.length}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-pt-sans">{c.name}</div>
              <div className="truncate text-[10px] text-white/50">
                {modeLabel(c.mode)} · {Math.round(c.distance)} m
              </div>
            </div>
          </button>
        );
      })}
      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={`conn-tip-${tip.key}`}
            role="tooltip"
            style={{
              left: tip.left,
              top: tip.top,
              width: TIP_WIDTH,
              transform: tip.above ? "translateY(-100%)" : undefined,
            }}
            className="pointer-events-none fixed z-[80] rounded-md bg-jakarta/98 px-2 py-1.5 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-sm"
          >
            <div className="px-0.5 pb-1 text-[9px] font-bold tracking-wide text-white/40 uppercase">
              {tip.routes.length} rute lain · {tip.name}
            </div>
            <ul>
              {tip.routes.map((r) => (
                <li key={r.route_id} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="shrink-0 rounded px-1 py-0.5 text-[9px] leading-none font-bold font-pt-sans-narrow"
                    style={{
                      backgroundColor: `#${r.route_color}`,
                      color:
                        calculateLuminance(r.route_color) > 0.5
                          ? "black"
                          : "white",
                    }}
                  >
                    {r.route_short_name}
                  </span>
                  <span className="truncate text-[10px] text-white/75">
                    {r.route_long_name}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

function RouteListSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse" aria-busy="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 p-2">
          <div className="w-10 h-10 rounded-full bg-white/20 shrink-0" />
          <div className="h-3 bg-white/15 rounded flex-1" />
        </div>
      ))}
    </div>
  );
}
