import { NextResponse } from "next/server";
import { getNearbyStations } from "@/lib/gtfs";
import { WALKING_RADIUS_M } from "@/utils/nearby";

/**
 * GET /api/nearby?lat=&lon=&radius=
 *
 * Stations of every dataset within a short walk of a point, closest first.
 * Cross-system by design: a station's transfer options live in the OTHER
 * modes. The caller owns the listing rules (see utils/nearby.ts), so this
 * returns raw candidates and distances rather than a curated list.
 */
export const revalidate = 86400;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawLat = searchParams.get("lat");
  const rawLon = searchParams.get("lon");
  const rawRadius = searchParams.get("radius");

  // Check for presence before coercing: Number(null) is 0, which would sail
  // past a Number.isFinite guard and silently search near Null Island.
  if (rawLat === null || rawLon === null) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 },
    );
  }

  const lat = Number(rawLat);
  const lon = Number(rawLon);
  const radius = rawRadius === null ? WALKING_RADIUS_M : Number(rawRadius);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(radius)
  ) {
    return NextResponse.json(
      { error: "lat, lon and radius must be numbers" },
      { status: 400 },
    );
  }
  // A radius is a walk, not a citywide search; the cap keeps a bogus value
  // from turning one request into a full network dump.
  const clamped = Math.min(Math.max(radius, 1), 2000);

  try {
    return NextResponse.json(await getNearbyStations(lat, lon, clamped), {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("Failed to read nearby stations:", err);
    return NextResponse.json(
      { error: "Nearby stations unavailable." },
      { status: 503 },
    );
  }
}
