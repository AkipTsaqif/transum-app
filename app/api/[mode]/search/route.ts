import { NextResponse } from "next/server";
import { parseMode, searchStations } from "@/lib/gtfs";

/** Unknown modes 404 at the router, not at runtime. */
export const dynamicParams = false;

/**
 * GET /api/gtfs/search?q=
 *
 * Stop-name search. Routes are already on the client (the 41 KB index), so
 * only stops need a round trip -- shipping all 6,437 station names would be
 * another 100 KB gzipped that most visitors never use.
 *
 * Dynamic by necessity: the response depends on the query string.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ mode: string }> }
) {
    const mode = parseMode((await params).mode);
    // An unknown /api/<mode>/* path is a 404, never another city's data.
    if (!mode) {
        return NextResponse.json({ error: "Unknown mode" }, { status: 404 });
    }

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    // Two characters is the point where results stop being the whole dataset.
    if (q.length < 2) return NextResponse.json([]);

    try {
        const results = await searchStations(q, 20, mode);
        return NextResponse.json(results, {
            headers: { "Cache-Control": "public, max-age=300" },
        });
    } catch (err) {
        console.error("Stop search failed:", err);
        return NextResponse.json(
            { error: "Search unavailable." },
            { status: 503 }
        );
    }
}
