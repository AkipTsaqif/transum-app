import { NextResponse } from "next/server";
import { getRouteDetail } from "@/lib/gtfs";

/**
 * GET /api/gtfs/routes/:id
 *
 * One route's geometry + the stops it serves. ~27 KB average, fetched only
 * when a user actually selects a route -- replacing the old ~30 MB of
 * shapes/stop_times/stops that every visitor downloaded up front.
 */
export const revalidate = 86400;

export async function GET(
    _request: Request,
    // Next.js 15: dynamic route params are async.
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const detail = await getRouteDetail(decodeURIComponent(id));

        if (!detail) {
            return NextResponse.json(
                { error: `Unknown route: ${id}` },
                { status: 404 }
            );
        }

        return NextResponse.json(detail, {
            headers: {
                "Cache-Control":
                    "public, max-age=3600, stale-while-revalidate=86400",
            },
        });
    } catch (err) {
        console.error(`Failed to read route ${id}:`, err);
        return NextResponse.json(
            { error: "Route data unavailable." },
            { status: 503 }
        );
    }
}
