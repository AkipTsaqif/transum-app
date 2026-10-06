"use client";

import MainMapComponent, {
    type DrawnLayer,
} from "@/components/map/main-map";
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
import { calculateLuminance, removeOppStopPrefix } from "@/utils/helper-fn";
import type {
    RouteDetail,
    RouteStop,
    RouteSummary,
    ShapeCollection,
    StationDetail,
    StationSearchHit,
} from "@/utils/types/gtfs";
import type { FeatureCollection } from "geojson";

import { ArrowLeft, ChevronRight, MapPin, Route, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function Index() {
    const [selectedMode, setSelectedMode] = useState<string>("Transjakarta");
    const [searchQuery, setSearchQuery] = useState<string>("");

    const [routes, setRoutes] = useState<RouteSummary[]>([]);
    const [routesLoading, setRoutesLoading] = useState(true);
    const [routesError, setRoutesError] = useState<string | null>(null);

    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const [detail, setDetail] = useState<RouteDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    // Mobile bottom-sheet height. Ignored at md+ where the sidebar is a column.
    const [sheetOpen, setSheetOpen] = useState(false);

    // Stop view: the clicked station, plus every route that calls there.
    // Faint city-wide network, shown only when nothing is selected.
    const [overview, setOverview] = useState<ShapeCollection | null>(null);
    // Every stop as points; fetched lazily the first time the user zooms in.
    const [allStops, setAllStops] = useState<FeatureCollection | null>(null);

    // Stop-name matches for the current query. Routes are filtered locally
    // from the index already on the client; stops live server-side.
    const [stopHits, setStopHits] = useState<StationSearchHit[]>([]);

    // Which pattern of the selected route to draw. null = the trunk(s).
    const [variantTripId, setVariantTripId] = useState<string | null>(null);

    const [station, setStation] = useState<StationDetail | null>(null);
    const [stationLoading, setStationLoading] = useState(false);
    const [stationError, setStationError] = useState<string | null>(null);
    const [stationRoutes, setStationRoutes] = useState<RouteDetail[]>([]);

    // Load the lightweight index once (~41 KB). Geometry is fetched per route.
    useEffect(() => {
        let cancelled = false;

        (async () => {
            setRoutesLoading(true);
            setRoutesError(null);
            try {
                const res = await fetch("/api/gtfs/routes");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: RouteSummary[] = await res.json();
                if (!cancelled) setRoutes(data);
            } catch (err) {
                if (!cancelled) {
                    setRoutesError(
                        "Gagal memuat daftar rute. Coba muat ulang halaman."
                    );
                    console.error("Failed to fetch route index:", err);
                }
            } finally {
                if (!cancelled) setRoutesLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedMode]);

    // Load the overview once, after the route list -- it is context, not
    // content, so it must never delay the interactive part of the page.
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const res = await fetch("/api/gtfs/overview");
                if (!res.ok) return;
                const data: ShapeCollection = await res.json();
                if (!cancelled) setOverview(data);
            } catch {
                // Non-fatal: the map simply opens without the faint network.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Fetch one route's geometry + stops on selection (~27 KB).
    // An AbortController keeps fast clicking from racing stale responses in.
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        abortRef.current?.abort();

        if (!selectedRouteId) {
            setDetail(null);
            setDetailError(null);
            return;
        }

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // A new route starts on its trunk.
        setVariantTripId(null);

        (async () => {
            setDetailLoading(true);
            setDetailError(null);
            try {
                const res = await fetch(
                    `/api/gtfs/routes/${encodeURIComponent(selectedRouteId)}`,
                    { signal: ctrl.signal }
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
    }, [selectedRouteId]);

    /**
     * Clicking a stop switches the map into "station mode": draw every route
     * that calls there, each in its own colour. Worst case in the current feed
     * is 14 routes (~290 KB); the median stop serves 1.
     */
    const stationAbortRef = useRef<AbortController | null>(null);

    const handleStopClick = useCallback(async (stop: RouteStop) => {
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
        setSheetOpen(true);

        try {
            const res = await fetch(`/api/gtfs/stops/resolve?${query}`, {
                signal: ctrl.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const detail: StationDetail = await res.json();
            if (ctrl.signal.aborted) return;

            setStation(detail);
            setSelectedRouteId(null);

            // Fetch each route's geometry in parallel.
            const results = await Promise.all(
                detail.routes.map(async (r) => {
                    const g = await fetch(
                        `/api/gtfs/routes/${encodeURIComponent(r.route_id)}`,
                        { signal: ctrl.signal }
                    );
                    if (!g.ok) return null;
                    return (await g.json()) as RouteDetail;
                })
            );
            if (ctrl.signal.aborted) return;
            setStationRoutes(results.filter((r): r is RouteDetail => !!r));
        } catch (err) {
            if ((err as Error).name === "AbortError") return;
            console.error("Failed to load stop:", err);
            setStationError("Gagal memuat halte ini.");
        } finally {
            if (!ctrl.signal.aborted) setStationLoading(false);
        }
    }, []);

    /**
     * Fetched on demand: only a visitor who zooms in far enough pays for it.
     * The ref guards against the map firing this on every zoom change.
     */
    const stopsRequested = useRef(false);

    const loadAllStops = useCallback(() => {
        if (stopsRequested.current) return;
        stopsRequested.current = true;

        (async () => {
            try {
                const res = await fetch("/api/gtfs/stops/geo");
                if (!res.ok) return;
                setAllStops((await res.json()) as FeatureCollection);
            } catch {
                // Non-fatal: zooming in simply shows no extra pins.
                stopsRequested.current = false;
            }
        })();
    }, []);

    /**
     * Resolve a station clicked on the GPU stop layer. Same path as a marker
     * click, but the layer only carries name + coordinates.
     */
    const handleStationClick = useCallback(
        (name: string, lat: number, lon: number) => {
            void handleStopClick({
                stop_id: "",
                stop_name: name,
                stop_lat: lat,
                stop_lon: lon,
                sequence: 0,
            });
        },
        // handleStopClick is stable (useCallback with [] deps).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const clearStation = useCallback(() => {
        stationAbortRef.current?.abort();
        setStation(null);
        setStationRoutes([]);
        setStationError(null);
        setStationLoading(false);
    }, []);

    /**
     * Clear everything drawn, leaving the camera untouched. With no layers the
     * bounds memo returns null and the fitBounds effect early-returns, so the
     * map holds its current position and zoom.
     */
    const clearSelection = useCallback(() => {
        abortRef.current?.abort();
        clearStation();
        setSelectedRouteId(null);
        setVariantTripId(null);
        setDetail(null);
        setDetailError(null);
        setDetailLoading(false);
    }, [clearStation]);

    // What the map draws: the station's routes when a stop is open, otherwise
    // the selected route -- either its trunk patterns or one chosen variant.
    const layers: DrawnLayer[] = useMemo(() => {
        if (station) {
            // Station view draws each route's trunk patterns only -- drawing
            // every diversion of every calling route would be unreadable.
            return stationRoutes.map((r) => {
                const trunkShapes = (r.variants ?? [])
                    .filter((v) => v.kind === "utama")
                    .map((v) => v.shape_id);
                const use = trunkShapes.length
                    ? trunkShapes
                    : Object.keys(r.geometryByShape ?? {});

                return {
                    id: r.route_id,
                    color: r.route_color,
                    geometry: {
                        type: "FeatureCollection" as const,
                        features: use
                            .map((s) => r.geometryByShape?.[s])
                            .filter((c): c is [number, number][] =>
                                Boolean(c?.length)
                            )
                            .map((coordinates) => ({
                                type: "Feature" as const,
                                properties: { shape_id: "" },
                                geometry: {
                                    type: "LineString" as const,
                                    coordinates,
                                },
                            })),
                    },
                };
            });
        }
        if (!detail) return [];

        const lineFor = (shapeId: string) => detail.geometryByShape?.[shapeId];

        const chosen = variantTripId
            ? detail.variants.filter((v) => v.trip_id === variantTripId)
            : detail.variants.filter((v) => v.kind === "utama");

        // Both trunk directions follow the same corridor a few metres apart.
        // Drawing both produced a dashed look where the two lines alternately
        // won the depth test, so when nothing specific is selected draw one
        // direction only -- the corridor is identical either way.
        const toDraw =
            !variantTripId && chosen.length > 1 ? [chosen[0]] : chosen;

        const features = toDraw
            .map((v) => lineFor(v.shape_id))
            .filter((c): c is [number, number][] => Boolean(c?.length))
            .map((coordinates) => ({
                type: "Feature" as const,
                properties: { shape_id: "" },
                geometry: { type: "LineString" as const, coordinates },
            }));

        // A route with no usable variant geometry: draw every shape it has
        // rather than leaving the map blank.
        if (!features.length) {
            const all = Object.values(detail.geometryByShape ?? {})
                .filter((c) => c?.length)
                .map((coordinates) => ({
                    type: "Feature" as const,
                    properties: { shape_id: "" },
                    geometry: { type: "LineString" as const, coordinates },
                }));
            if (!all.length) return [];
            return [
                {
                    id: detail.route_id,
                    color: detail.route_color,
                    geometry: { type: "FeatureCollection", features: all },
                },
            ];
        }

        return [
            {
                id: `${detail.route_id}:${variantTripId ?? "utama"}`,
                color: detail.route_color,
                geometry: { type: "FeatureCollection", features },
            },
        ];
    }, [station, stationRoutes, detail, variantTripId]);

    // Stops shown as pins: every stop of every drawn route, de-duplicated.
    const visibleStops: RouteStop[] = useMemo(() => {
        if (station) {
            const seen = new Set<string>();
            const out: RouteStop[] = [];
            for (const r of stationRoutes) {
                for (const s of r.stops) {
                    if (seen.has(s.stop_id)) continue;
                    seen.add(s.stop_id);
                    out.push(s);
                }
            }
            return out;
        }
        if (!detail) return [];

        // Limit pins to the pattern actually drawn, so a diversion does not
        // show stops it never calls at.
        const v = variantTripId
            ? detail.variants.find((x) => x.trip_id === variantTripId)
            : null;
        if (v) {
            const allow = new Set(v.stopIds);
            const only = detail.stops.filter((s) => allow.has(s.stop_id));
            if (only.length) return only;
        }
        return detail.stops;
    }, [station, stationRoutes, detail, variantTripId]);

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
                const res = await fetch(
                    `/api/gtfs/search?q=${encodeURIComponent(q)}`,
                    { signal: ctrl.signal }
                );
                if (!res.ok) return;
                setStopHits((await res.json()) as StationSearchHit[]);
            } catch {
                // Aborted or offline: routes still filter locally.
            }
        }, 200);

        return () => {
            clearTimeout(timer);
            ctrl.abort();
        };
    }, [searchQuery]);

    // Derived state belongs in useMemo, not in a useEffect + setState pair.
    const filteredRoutes = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return routes;
        return routes.filter(
            (r) =>
                r.route_long_name.toLowerCase().includes(q) ||
                r.route_short_name.toLowerCase().includes(q)
        );
    }, [routes, searchQuery]);

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
                className={`order-2 flex w-full shrink-0 flex-col rounded-t-2xl bg-jakarta text-white transition-[height] duration-300 ease-out md:order-1 md:h-full md:w-96 md:rounded-none md:transition-none ${
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
                    <Link href={"/"}>Transum App - {selectedMode}</Link>
                </div>
                <Separator className="hidden md:block" />
                <div className="hidden w-full flex-col p-4 md:flex">
                    <Select
                        onValueChange={(val) => setSelectedMode(val)}
                        defaultValue="Transjakarta"
                        disabled
                    >
                        <SelectTrigger className="w-full border-white/20 bg-white/10 text-white [&>svg]:opacity-70">
                            <SelectValue placeholder="Pilih moda" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectLabel className="pl-4">
                                    Jakarta
                                </SelectLabel>
                                <SelectItem value="Transjakarta">
                                    Transjakarta
                                </SelectItem>
                                <SelectItem value="MRT Jakarta">
                                    MRT Jakarta
                                </SelectItem>
                                <SelectItem value="KCI">KCI</SelectItem>
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
                        {station && (
                            <StopPanel
                                station={station}
                                loading={stationLoading}
                                error={stationError}
                                onBack={clearStation}
                                onPickRoute={(id) => {
                                    clearStation();
                                    setSelectedRouteId(id);
                                }}
                            />
                        )}

                        {/* Matching stops, above the matching routes. */}
                        {!station && stopHits.length > 0 && (
                            <div className="-ml-4 -mr-4 mb-2">
                                <div className="px-4 pb-1 text-xs font-bold tracking-wide text-white/40 uppercase">
                                    Halte
                                </div>
                                {stopHits.map((s) => (
                                    <button
                                        key={`${s.name}@${s.lat},${s.lon}`}
                                        type="button"
                                        onClick={() => {
                                            handleStationClick(
                                                s.name,
                                                s.lat,
                                                s.lon
                                            );
                                            setSheetOpen(false);
                                        }}
                                        className="flex w-full cursor-pointer items-center gap-2 p-2 pr-4 pl-4 text-left text-white transition-colors hover:bg-white/10"
                                    >
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                                            <MapPin size={16} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-pt-sans">
                                                {s.name}
                                            </div>
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

                        {!station && routesLoading && <RouteListSkeleton />}

                        {routesError && (
                            <div className="text-sm text-red-200 bg-red-900/40 rounded p-3">
                                {routesError}
                            </div>
                        )}

                        {!station &&
                            !routesLoading &&
                            !routesError &&
                            filteredRoutes.length === 0 &&
                            stopHits.length === 0 && (
                                <div className="text-sm text-white/60 p-2">
                                    Tidak ada rute atau halte yang cocok dengan
                                    &quot;{searchQuery}&quot;.
                                </div>
                            )}

                        {!station &&
                            !routesLoading &&
                            filteredRoutes.map((r) => {
                                const isSelected = selectedRouteId === r.route_id;
                                return (
                                    <button
                                        key={r.route_id}
                                        type="button"
                                        aria-pressed={isSelected}
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
                                            setSelectedRouteId(
                                                isSelected ? null : r.route_id
                                            );
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
                                                    calculateLuminance(
                                                        r.route_color
                                                    ) > 0.5
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
                    about the thing being drawn, so it belongs next to it. */}
                {!station && detail && (
                    <VariantPanel
                        detail={detail}
                        selected={variantTripId}
                        onSelect={setVariantTripId}
                        onClear={clearSelection}
                    />
                )}

                <MainMapComponent
                    layers={layers}
                    routeStops={visibleStops}
                    overview={overview}
                    allStops={allStops}
                    onStationClick={handleStationClick}
                    onNeedAllStops={loadAllStops}
                    activeStop={
                        station
                            ? {
                                  lat: station.lat,
                                  lon: station.lon,
                                  name: station.name,
                              }
                            : null
                    }
                    onStopClick={handleStopClick}
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
    selected,
    onSelect,
    onClear,
}: {
    detail: RouteDetail;
    selected: string | null;
    onSelect: (tripId: string | null) => void;
    /** Clears the whole route selection; rendered in this panel's header. */
    onClear: () => void;
}) {
    const [showOther, setShowOther] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    const variants = detail.variants ?? [];
    // Rendered even for a single pattern (40 of 240 routes): the card carries
    // the only clear-selection control, and the pattern list simply collapses
    // to one row.
    if (!variants.length) return null;

    const diversions = variants.filter((v) => v.kind === "alihan");
    const others = variants.filter(
        (v) => v.kind === "pendek" || v.kind === "putaran"
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
                <span className="block truncate text-xs font-pt-sans">
                    {title}
                </span>
                <span className="block text-[11px] text-white/50">{sub}</span>
            </span>
        </button>
    );

    const activeLabel = selected
        ? (() => {
              const v = variants.find((x) => x.trip_id === selected);
              return v ? (v.via ? `via ${v.via}` : v.headsign) : "Utama";
          })()
        : "Utama";

    return (
        <div className="pointer-events-auto absolute top-3 left-3 z-20 flex max-h-[calc(100%-1.5rem)] w-60 flex-col overflow-hidden rounded-lg bg-jakarta/95 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-sm">
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
                            calculateLuminance(detail.route_color) > 0.5
                                ? "black"
                                : "white",
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
                        <span className="block truncate text-xs">
                            {activeLabel}
                        </span>
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
                // min-h-0 lets this flex child actually shrink, so the list
                // scrolls inside the card instead of pushing the footnote
                // past the bottom edge.
                <div className="min-h-0 flex-1 overflow-y-auto pb-1">

            {variants
                .filter((v) => v.kind === "utama")
                .map((v) => (
                    <Row
                        key={v.trip_id}
                        id={v.trip_id}
                        active={selected === null}
                        title={`Utama ${dirLabel(v.direction_id)} ${v.headsign}`}
                        sub={`${v.stopCount} halte${
                            v.headwaySecs
                                ? ` \u00b7 tiap ${Math.round(v.headwaySecs / 60)} mnt`
                                : ""
                        }`}
                        onClick={() => onSelect(null)}
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
                                    onSelect(
                                        selected === v.trip_id ? null : v.trip_id
                                    )
                                }
                            />
                        ))}
                </>
            )}

                </div>
            )}

            {/*
              Pinned outside the scroll area. It used to sit inside, so once
              the variant list overflowed the card's max height the footnote
              was pushed below the fold and clipped.
            */}
            {!collapsed && (
                <p className="shrink-0 border-t border-white/10 px-3 pt-2 pb-2.5 text-[10px] leading-snug text-white/35">
                    Hanya tampil bila dipilih. GTFS tidak mencatat pengalihan
                    yang sedang berlaku.
                </p>
            )}
        </div>
    );
}

/**
 * Replaces the route list while a stop is open: the station name and every
 * route calling there, each clickable to switch back to single-route view.
 */
function StopPanel({
    station,
    loading,
    error,
    onBack,
    onPickRoute,
}: {
    station: StationDetail;
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onPickRoute: (routeId: string) => void;
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
                        {station.platforms > 1 &&
                            ` \u00b7 ${station.platforms} peron`}
                    </div>
                    <h2 className="text-lg leading-tight font-bold font-pt-sans">
                        {station.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-white/60">
                        {station.routes.length} rute berhenti di sini
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

            {station.routes.map((r) => (
                <button
                    key={r.route_id}
                    type="button"
                    onClick={() => onPickRoute(r.route_id)}
                    className="flex w-full cursor-pointer items-center gap-2 p-2 pr-4 pl-4 text-left text-white transition-colors hover:bg-white/10"
                >
                    <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold font-pt-sans-narrow"
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
                    <div className="min-w-0 flex-1">
                        <div className="font-pt-sans">{r.route_long_name}</div>
                        {r.position && r.totalStops && (
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
