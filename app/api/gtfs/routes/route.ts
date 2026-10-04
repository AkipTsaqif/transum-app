import { NextResponse } from "next/server";
import { getRouteIndex } from "@/lib/gtfs";

/**
 * GET /api/gtfs/routes
 *
 * The sidebar index: ~41 KB for all 240 routes, no geometry.
 * Static between GTFS syncs, so it is cached indefinitely and revalidated
 * daily -- a rebuild (which re-runs the sync) is what actually changes it.
 */
export const revalidate = 86400;

export async function GET() {
    try {
        const routes = await getRouteIndex();
        return NextResponse.json(routes, {
            headers: {
                "Cache-Control":
                    "public, max-age=3600, stale-while-revalidate=86400",
            },
        });
    } catch (err) {
        console.error("Failed to read GTFS route index:", err);
        return NextResponse.json(
            { error: "Route index unavailable. Run `npm run sync:gtfs`." },
            { status: 503 }
        );
    }
}
