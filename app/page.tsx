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
import { Route, Shape } from "@/utils/types/gtfs";
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

	const fetchRoutes = async () => {
		try {
			const res = await fetch("/api/gtfs/routes");
			const data = await res.json();

			setRoutes(data);
		} catch (error) {
			console.error("Failed to fetch routes:", error);
		}
	};

	useEffect(() => {
		if (selectedMode) fetchRoutes();
	}, [selectedMode]);

	return (
		<div className="flex w-full relative">
			<div className="w-96 flex flex-col bg-jakarta text-white h-screen">
				<div className="flex items-center font-semibold p-4">
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
										className="flex items-center gap-2 p-2 text-white hover:bg-white hover:bg-opacity-10 cursor-pointer -ml-4 -mr-4 pl-4 pr-4"
										onClick={() => console.log(route)}
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
			<div className="w-full overflow-hidden">
				<MainMapComponent />
			</div>
			<div className="flex gap-2 absolute top-0 right-0">
				{route && route}
				{stop && stop}
			</div>
		</div>
	);
}
