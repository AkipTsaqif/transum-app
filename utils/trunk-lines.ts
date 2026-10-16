import type { RouteDetail } from "@/utils/types/gtfs";

type LngLat = [number, number];
type Line = LngLat[];

/**
 * Drawing a route's trunk patterns.
 *
 * A route usually has one trunk pattern per direction. They often share a
 * street, running a few metres apart, and drawing both there made the two
 * lines alternately win the depth test and the line look dashed. The original
 * workaround was to draw the first direction only -- but that silently drops
 * the return trip wherever it takes different streets (route 2's return leg
 * through Balai Kota, Gambir and Kwitang, for one). By measurement the
 * directions share their street in only 28 of 170 two-direction routes.
 *
 * So: draw the first trunk in full, then add only the stretches of the other
 * trunks that are NOT already on a drawn line. Shared stretches are drawn
 * once, so nothing z-fights; diverging stretches are drawn, so nothing is
 * missing.
 */

/** A stretch of the other direction this close to a drawn line counts as shared. */
const SHARED_WITHIN_M = 30;

/**
 * Points are tested every this many metres along the line. Also the grid cell
 * size, so a lookup only has to inspect the 3x3 cells around a point.
 */
const STEP_M = 20;

/** Gaps shorter than this between two kept runs are closed up, not split. */
const BRIDGE_M = 60;

/** Kept runs shorter than this are noise (a stray vertex), not a street. */
const MIN_RUN_M = 40;

/** A run with more than this share on an earlier run of the same pattern is a repeat. */
const MOSTLY_REPEATED = 0.6;

const M_PER_DEG_LAT = 110540;

/** Metres between two points, flat-earth -- accurate to well under a metre at city scale. */
const metres = (a: LngLat, b: LngLat, kx: number): number =>
    Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG_LAT);

/** Longitude degrees -> metres at this latitude. */
const lonScale = (lat: number): number =>
    Math.cos((lat * Math.PI) / 180) * 111320;

/**
 * Resamples a polyline to points ~`step` metres apart, keeping each point's
 * distance along the line so kept runs can be measured afterwards.
 */
function resample(line: Line, kx: number, step: number) {
    const pts: { p: LngLat; at: number }[] = [];
    let travelled = 0;
    let nextAt = 0;

    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const seg = metres(a, b, kx);
        if (!Number.isFinite(seg) || seg === 0) continue;

        while (nextAt <= travelled + seg) {
            const t = (nextAt - travelled) / seg;
            pts.push({
                p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
                at: nextAt,
            });
            nextAt += step;
        }
        travelled += seg;
    }

    const last = line[line.length - 1];
    if (last && (!pts.length || pts[pts.length - 1].at < travelled)) {
        pts.push({ p: last, at: travelled });
    }
    return pts;
}

/**
 * Spatial hash of already-drawn lines, so "is this point near a drawn line?"
 * is a handful of lookups rather than a scan of every drawn point.
 */
function buildIndex(lines: Line[], kx: number) {
    const cells = new Map<string, LngLat[]>();
    const key = (x: number, y: number) => `${x}|${y}`;
    // A point within 30m can sit two 20m cells away across a cell boundary.
    const cellRadius = Math.ceil(SHARED_WITHIN_M / STEP_M);
    const cellOf = (p: LngLat) => [
        Math.floor((p[0] * kx) / STEP_M),
        Math.floor((p[1] * M_PER_DEG_LAT) / STEP_M),
    ];

    for (const line of lines) {
        for (const { p } of resample(line, kx, STEP_M / 2)) {
            const [cx, cy] = cellOf(p);
            const k = key(cx, cy);
            const bucket = cells.get(k);
            if (bucket) bucket.push(p);
            else cells.set(k, [p]);
        }
    }

    return (p: LngLat): boolean => {
        const [cx, cy] = cellOf(p);
        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                const bucket = cells.get(key(cx + dx, cy + dy));
                if (!bucket) continue;
                for (const q of bucket) {
                    if (metres(p, q, kx) <= SHARED_WITHIN_M) return true;
                }
            }
        }
        return false;
    };
}

/**
 * The parts of `line` that are more than SHARED_WITHIN_M from every line in
 * `drawn`. Returned as separate polylines, one per diverging stretch.
 */
export function divergingRuns(line: Line, drawn: Line[]): Line[] {
    if (line.length < 2) return [];
    if (!drawn.length) return [line];

    const midLat = line[Math.floor(line.length / 2)][1];
    const kx = lonScale(midLat);
    const near = buildIndex(drawn, kx);
    const pts = resample(line, kx, STEP_M);
    if (pts.length < 2) return [];

    // Walk the line, collecting runs of consecutive "not near a drawn line".
    type Run = { from: number; to: number };
    const runs: Run[] = [];
    let open: Run | null = null;

    pts.forEach(({ p }, i) => {
        if (near(p)) {
            if (open) {
                runs.push(open);
                open = null;
            }
            return;
        }
        if (open) open.to = i;
        else open = { from: i, to: i };
    });
    if (open) runs.push(open);

    // Close small gaps -- one noisy "near" sample in the middle of a long
    // divergence should not split it into two stubs with a hole between.
    const merged: Run[] = [];
    for (const r of runs) {
        const prev = merged[merged.length - 1];
        if (prev && pts[r.from].at - pts[prev.to].at <= BRIDGE_M) {
            prev.to = r.to;
        } else {
            merged.push({ ...r });
        }
    }

    // Each kept run is stretched by one sample at either end so it joins the
    // drawn line it branches from, rather than stopping short of it.
    const candidates = merged
        .filter((r) => pts[r.to].at - pts[r.from].at >= MIN_RUN_M)
        .map((r) => {
            const from = Math.max(0, r.from - 1);
            const to = Math.min(pts.length - 1, r.to + 1);
            return pts.slice(from, to + 1).map(({ p }) => p);
        })
        .filter((run) => run.length >= 2);

    // A single pattern can double back over its own diverging street (a
    // turnaround loop, or an out-and-back to a terminal). The check above only
    // compared it with *other* lines, so those repeats would be drawn twice and
    // brought the dashed look back. Keep a run only if most of it is new.
    const kept: Line[] = [];
    for (const run of candidates) {
        if (kept.length) {
            const onKept = buildIndex(kept, kx);
            const dup = run.filter((p) => onKept(p)).length / run.length;
            if (dup > MOSTLY_REPEATED) continue;
        }
        kept.push(run);
    }
    return kept;
}

/**
 * Every trunk pattern's geometry, as non-overlapping lines ready to draw.
 *
 * The first trunk is returned whole; each later one contributes only the
 * stretches that leave the lines already returned.
 */
export function trunkLines(
    detail: Pick<RouteDetail, "variants" | "geometryByShape">
): Line[] {
    const shapes = (detail.variants ?? [])
        .filter((v) => v.kind === "utama")
        .map((v) => detail.geometryByShape?.[v.shape_id])
        .filter((c): c is Line => Boolean(c?.length));

    if (shapes.length <= 1) return shapes;

    const out: Line[] = [shapes[0]];
    for (let i = 1; i < shapes.length; i++) {
        out.push(...divergingRuns(shapes[i], out));
    }
    return out;
}
