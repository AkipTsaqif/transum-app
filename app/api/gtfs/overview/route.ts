import { NextResponse } from "next/server";
import { getOverview } from "@/lib/gtfs";

/**
 * GET /api/gtfs/overview
 *
 * All 240 routes as one simplified FeatureCollection, drawn faintly behind
 * everything when no route is selected.
 *
 * Fetching the 240 real route files instead would be 240 requests and roughly
 * 800 KB gzipped. Simplified to ~22 m, which is well under a pixel at the
 * zoom levels this layer is visible at.
 *
 * Compression is left to the platform. Reading `accept-encoding` here would
 * opt the route out of static rendering (Next cannot prerender a response that
 * varies by request header), which costs more than gzip saves: as a static
 * route this is served from the edge cache with compression already applied.
 */
export const revalidate = 86400;

export async function GET() {
    try {
        const overview = await getOverview();

        return NextResponse.json(overview, {
            headers: {
                "Cache-Control":
                    "public, max-age=3600, stale-while-revalidate=86400",
            },
        });
    } catch (err) {
        console.error("Failed to read overview:", err);
        return NextResponse.json(
            { error: "Overview unavailable. Run `npm run sync:gtfs`." },
            { status: 503 }
        );
    }
}
