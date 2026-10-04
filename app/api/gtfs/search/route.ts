import { NextResponse } from "next/server";
import { searchStations } from "@/lib/gtfs";

/**
 * GET /api/gtfs/search?q=
 *
 * Stop-name search. Routes are already on the client (the 41 KB index), so
 * only stops need a round trip -- shipping all 6,437 station names would be
 * another 100 KB gzipped that most visitors never use.
 *
 * Dynamic by necessity: the response depends on the query string.
 */
export async function GET(request: Request) {
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    // Two characters is the point where results stop being the whole dataset.
    if (q.length < 2) return NextResponse.json([]);

    try {
        const results = await searchStations(q, 20);
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
