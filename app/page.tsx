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
import { Route, Shape, Stop, StopTime, Trip } from "@/utils/types/gtfs";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Index({
    route,
    stop,
}: {
    route: React.ReactNode;
    stop: React.ReactNode;
}) {
    const [selectedMode, setSelectedMode] = useState<string | null>(
        "Transjakarta"
    );
    const [routes, setRoutes] = useState<Route[]>([]);
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [trips, setTrips] = useState<Trip[]>([]);
    const [stops, setStops] = useState<Stop[]>([]);
    const [stopTimes, setStopTimes] = useState<StopTime[]>([]);

    const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
    const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
    const [filteredShapes, setFilteredShapes] = useState<Shape[]>([]);
    const [stopsForRoute, setStopsForRoute] = useState<Stop[]>([]);

    const fetchRoutes = async () => {
        try {
            const res = await fetch("/api/gtfs/routes");
            const data = await res.json();

            setRoutes(data);
        } catch (error) {
            console.error("Failed to fetch routes:", error);
        }
    };

    const fetchShapes = async () => {
        try {
            const res = await fetch("/api/gtfs/shapes");
            const data = await res.json();

            setShapes(data);
        } catch (error) {
            console.error("Failed to fetch shapes:", error);
        }
    };

    const fetchTrips = async () => {
        try {
            const res = await fetch("/api/gtfs/trips");
            const data = await res.json();

            setTrips(data);
        } catch (error) {
            console.error("Failed to fetch trips:", error);
        }
    };

    const fetchStops = async () => {
        try {
            const res = await fetch("/api/gtfs/stops");
            const data = await res.json();

            setStops(data);
        } catch (error) {
            console.error("Failed to fetch stops:", error);
        }
    };

    const fetchStopTimes = async () => {
        try {
            const res = await fetch("/api/gtfs/stop-times");
            const data = await res.json();

            setStopTimes(data);
        } catch (error) {
            console.error("Failed to fetch stop times:", error);
        }
    };

    useEffect(() => {
        if (selectedMode) {
            fetchRoutes();
            fetchShapes();
            fetchTrips();
            fetchStops();
            fetchStopTimes();
        }
    }, [selectedMode]);

    useEffect(() => {
        if (selectedRoute) {
            const shapeIdsForRoute = trips
                .filter((trip) => trip.route_id === selectedRoute.route_id)
                .map((trip) => trip.shape_id);

            const shapesForRoute = shapes.filter((shape) =>
                shapeIdsForRoute.includes(shape.shape_id)
            );

            setFilteredShapes(shapesForRoute);
        } else {
            setFilteredShapes([]);
        }
    }, [selectedRoute]);

    useEffect(() => {
        if (selectedRoute) {
            const routeTrips = trips.filter(
                (trip) => trip.route_id === selectedRoute.route_id
            );

            const stopIds = new Set<string>();
            routeTrips.forEach((trip) => {
                stopTimes
                    .filter((stopTime) => stopTime.trip_id === trip.trip_id)
                    .forEach((stopTime) => stopIds.add(stopTime.stop_id));
            });

            const stopsForSelectedRoute = stops.filter((stop) =>
                stopIds.has(stop.stop_id)
            );

            console.log("stopsForSelectedRoute", stopsForSelectedRoute);
            setStopsForRoute(stopsForSelectedRoute);
        } else {
            setStopsForRoute([]);
        }
    }, [selectedRoute, trips, stopTimes, stops]);

    return (
        <div className="flex w-full relative">
            <div className="w-96 flex flex-col bg-jakarta text-white h-screen">
                <div className="flex items-center font-bold p-4 text-xl font-pt-sans-narrow">
                    <Link href={"/"}>Transum App - {selectedMode}</Link>
                </div>
                <Separator />
                <div className="flex flex-col w-full p-4">
                    <Select
                        onValueChange={(val) => setSelectedMode(val)}
                        defaultValue="Transjakarta"
                        disabled
                    >
                        <SelectTrigger className="w-full text-black">
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
                {selectedMode && (
                    <>
                        <Separator />
                        <div className="flex flex-col w-full flex-grow overflow-y-auto">
                            <div className="p-4">
                                <Input placeholder="Cari rute" />
                            </div>
                            <div className="h-full max-h-screen overflow-y-scroll pl-4 pr-4">
                                {routes.map((route: Route) => (
                                    <div
                                        key={route.route_id}
                                        className={`flex items-center gap-2 p-2 text-white cursor-pointer -ml-4 -mr-4 pl-4 pr-4 ${
                                            selectedRoute?.route_id ===
                                            route.route_id
                                                ? "bg-jakarta-selected hover:bg-[#004C7C]" // change the color if selected
                                                : "hover:bg-white hover:bg-opacity-10"
                                        }`}
                                        onClick={() => setSelectedRoute(route)}
                                    >
                                        <div
                                            className="flex w-10 h-10 text-sm font-bold rounded-full bg-white text-black items-center justify-center border-[6px]"
                                            style={{
                                                borderColor: `#${route.route_color}`,
                                            }}
                                        >
                                            {route.route_short_name}
                                        </div>
                                        <div className="flex-1">
                                            {route.route_long_name}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
            <div className="w-full">
                <MainMapComponent
                    shapes={filteredShapes}
                    lineColor={selectedRoute?.route_color}
                    routeStops={stopsForRoute}
                />
            </div>
            <div className="flex gap-2 absolute top-0 right-0">
                {route && route}
                {stop && stop}
            </div>
        </div>
    );
}
