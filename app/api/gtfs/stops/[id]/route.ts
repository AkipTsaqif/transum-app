import { NextResponse } from "next/server";
import { getStationDetail } from "@/lib/gtfs";

/**
 * GET /api/gtfs/stops/:id
 *
 * One station: its platforms and the full summary of every route that calls
 * there. ~1-3 KB. The station index itself stays on the server -- the client
 * never downloads all 6,437 stations (922 KB) just to open one.
 */
export const revalidate = 86400;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const station = await getStationDetail(decodeURIComponent(id));

        if (!station) {
            return NextResponse.json(
                { error: `Unknown stop: ${id}` },
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
        console.error(`Failed to read stop ${id}:`, err);
        return NextResponse.json(
            { error: "Stop data unavailable." },
            { status: 503 }
        );
    }
}
