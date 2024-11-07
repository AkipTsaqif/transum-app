// app/api/gtfs/route.ts
import { NextResponse } from "next/server";
import AdmZip from "adm-zip";
import path from "path";
import fs from "fs";

export async function GET() {
	const zipPath = path.join(process.cwd(), "public", "gtfs-tj.zip");

	if (!fs.existsSync(zipPath)) {
		return NextResponse.json(
			{ error: "GTFS ZIP file not found" },
			{ status: 404 }
		);
	}

	const zip = new AdmZip(zipPath);

	// const stopsFile = zip.getEntry("stops.txt");
	const routesFile = zip.getEntry("routes.txt");
	if (!routesFile) {
		return NextResponse.json(
			{ error: "stops.txt not found in GTFS ZIP" },
			{ status: 404 }
		);
	}

	const stopsContent = routesFile.getData().toString("utf-8");

	const stopsArray = stopsContent.split("\n").map((line) => line.split(","));

	return NextResponse.json(stopsArray);
}
