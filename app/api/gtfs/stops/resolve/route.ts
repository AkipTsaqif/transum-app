import { NextResponse } from "next/server";
import { resolveStation } from "@/lib/gtfs";

/**
 * GET /api/gtfs/stops/resolve?name=&lat=&lon=
 *
 * Maps a raw GTFS stop to the clustered station that contains it.
 *
 * The client cannot compute a station id itself: ids are built from the
 * cluster's *centroid*, which only exists after all member platforms are
 * merged. So the map sends the stop it actually rendered and the server
 * resolves it against the baked index.
 */
export const revalidate = 86400;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");
    const rawLat = searchParams.get("lat");
    const rawLon = searchParams.get("lon");

    // Check for presence before coercing: Number(null) is 0, which would sail
    // past a Number.isFinite guard and silently search near Null Island.
    if (!name || rawLat === null || rawLon === null) {
        return NextResponse.json(
            { error: "name, lat and lon are required" },
            { status: 400 }
        );
    }

    const lat = Number(rawLat);
    const lon = Number(rawLon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return NextResponse.json(
            { error: "lat and lon must be numbers" },
            { status: 400 }
        );
    }

    try {
        const station = await resolveStation(name, lat, lon);

        if (!station) {
            return NextResponse.json(
                { error: `No station near ${name}` },
                { status: 404 }
            );
        }

        return NextResponse.json(station, {
            headers: {
                "Cache-Control":
                    "public, max-age=3600, stale-while-revalidate=86400",
            },
        });
    } catch (err) {
        console.error("Failed to resolve stop:", err);
        return NextResponse.json(
            { error: "Stop data unavailable." },
            { status: 503 }
        );
    }
}
