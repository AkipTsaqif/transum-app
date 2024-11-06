"use client";

import MainMapComponent from "@/components/map/main-map";
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
import Link from "next/link";
import { useState } from "react";

export default function Index({
	routes,
	stops,
}: {
	routes: React.ReactNode;
	stops: React.ReactNode;
}) {
	const [selectedMode, setSelectedMode] = useState<string | null>(null);

	return (
		<div className="flex w-full relative">
			<div className="w-96 flex flex-col">
				<div className="flex items-center font-semibold p-4">
					<Link href={"/"}>Transum App - {selectedMode}</Link>
				</div>
				<Separator />
				<div className="flex flex-col w-full p-4">
					<Select onValueChange={(val) => setSelectedMode(val)}>
						<SelectTrigger className="w-full">
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
				<Separator />
			</div>
			<div className="w-full">
				<MainMapComponent />
			</div>
			<div className="flex gap-2 absolute top-0 right-0">
				{routes && routes}
				{stops && stops}
			</div>
		</div>
	);
}
