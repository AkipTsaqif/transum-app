import { NextResponse } from "next/server";
import { Route } from "@/utils/types/gtfs";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse";

export async function GET() {
	const zipPath = path.join(process.cwd(), "public", "gtfs-tj.zip");

	if (!fs.existsSync(zipPath)) {
		return NextResponse.json(
			{ error: "GTFS ZIP file not found" },
			{ status: 404 }
		);
	}

	const zip = new AdmZip(zipPath);
	const shapesFile = zip.getEntry("shapes.txt");

	if (!shapesFile) {
		return NextResponse.json(
			{ error: "shapes.txt not found in GTFS ZIP" },
			{ status: 404 }
		);
	}

	const shapesContet = shapesFile.getData().toString("utf-8");

	return new Promise((resolve) => {
		parse(
			shapesContet,
			{ columns: true, trim: true },
			(err, records: Route[]) => {
				if (err) {
					resolve(
						NextResponse.json(
							{ error: "Error parsing route data" },
							{ status: 500 }
						)
					);
				} else {
					resolve(NextResponse.json(records));
				}
			}
		);
	});
}