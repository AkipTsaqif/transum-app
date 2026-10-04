"use client";

import MainMapComponent from "@/components/map/main-map";
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
import { calculateLuminance } from "@/utils/helper-fn";
import type { RouteDetail, RouteSummary } from "@/utils/types/gtfs";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
                        <Input
                            placeholder="Cari rute"
                            aria-label="Cari rute"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="border-white/20 bg-white/10 text-white placeholder:text-white/50 focus-visible:ring-white/40 focus-visible:ring-offset-jakarta"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto pl-4 pr-4 pb-4">
                        {routesLoading && <RouteListSkeleton />}

                        {routesError && (
                            <div className="text-sm text-red-200 bg-red-900/40 rounded p-3">
                                {routesError}
                            </div>
                        )}

                        {!routesLoading &&
                            !routesError &&
                            filteredRoutes.length === 0 && (
                                <div className="text-sm text-white/60 p-2">
                                    Tidak ada rute yang cocok dengan &quot;
                                    {searchQuery}&quot;.
                                </div>
                            )}

                        {!routesLoading &&
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

            <div className="order-1 min-h-0 w-full flex-1 md:order-2 md:h-full md:flex-none">
                <MainMapComponent
                    geometry={detail?.geometry ?? null}
                    lineColor={detail?.route_color}
                    routeStops={detail?.stops ?? []}
                />
            </div>
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
