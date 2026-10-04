import { NextResponse } from "next/server";
import { getStopLayer } from "@/lib/gtfs";

/**
 * GET /api/gtfs/stops/geo
 *
 * Every station as GeoJSON points (~173 KB gzipped), rendered by the GPU as
 * circles once the user zooms past the threshold. Carries only name and route
 * count -- a click still resolves full detail through /stops/resolve.
 */
export const revalidate = 86400;

export async function GET() {
    try {
        return NextResponse.json(await getStopLayer(), {
            headers: {
                "Cache-Control":
                    "public, max-age=3600, stale-while-revalidate=86400",
            },
        });
    } catch (err) {
        console.error("Failed to read stop layer:", err);
        return NextResponse.json(
            { error: "Stop layer unavailable." },
            { status: 503 }
        );
    }
}
