import { NextResponse } from "next/server";
import { getStopLayer, parseMode } from "@/lib/gtfs";
import { TRANSIT_MODES } from "@/lib/gtfs";

/**
 * The mode is a path segment (`/api/gtfs/...`, `/api/krl/...`), not a query
 * parameter: reading `request.url` would turn this route dynamic and drop its
 * build-time prerender, whereas a path segment with `generateStaticParams`
 * keeps both modes static. `dynamicParams = false` makes any other mode a 404.
 */
export const dynamicParams = false;
export const generateStaticParams = () =>
    TRANSIT_MODES.map((mode) => ({ mode }));


/**
 * GET /api/gtfs/stops/geo
 *
 * Every station as GeoJSON points (~173 KB gzipped), rendered by the GPU as
 * circles once the user zooms past the threshold. Carries only name and route
 * count -- a click still resolves full detail through /stops/resolve.
 */
export const revalidate = 86400;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ mode: string }> }
) {
    const mode = parseMode((await params).mode);

    try {
        return NextResponse.json(await getStopLayer(mode), {
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
