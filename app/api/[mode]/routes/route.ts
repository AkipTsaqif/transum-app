import { NextResponse } from "next/server";
import { getRouteIndex, parseMode } from "@/lib/gtfs";
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
 * GET /api/gtfs/routes
 *
 * The sidebar index: ~41 KB for all 240 routes, no geometry.
 * Static between GTFS syncs, so it is cached indefinitely and revalidated
 * daily -- a rebuild (which re-runs the sync) is what actually changes it.
 */
export const revalidate = 86400;

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ mode: string }> }
) {
    const mode = parseMode((await params).mode);
    // An unknown /api/<mode>/* path is a 404, never another city's data.
    if (!mode) {
        return NextResponse.json({ error: "Unknown mode" }, { status: 404 });
    }


    try {
        const routes = await getRouteIndex(mode);
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
