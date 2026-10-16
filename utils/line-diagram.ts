import type { RouteDetail, RouteStop, RouteVariant } from "@/utils/types/gtfs";
import { haversine, removeOppStopPrefix, routeTerminals } from "@/utils/helper-fn";

/**
 * Linear route diagram ("strip map") data.
 *
 *  - `dual`: both directions side by side, one row per place. A row is either
 *    one shared stop (a median BRT platform both directions use), an opposite
 *    pair across the road, or a stop served in one direction only -- where
 *    the two directions take different streets, the other rail simply runs
 *    past that row with no dot. Used for every route that has a return leg.
 *  - `single`: one pattern as a plain line. Only for a picked diversion, or
 *    a route the feed gives a single direction for.
 */

export type DiagramRow =
    | { kind: "shared"; stop: RouteStop }
    | { kind: "pair"; a: RouteStop; b: RouteStop }
    | { kind: "a"; a: RouteStop }
    | { kind: "b"; b: RouteStop };

export interface DualDiagram {
    layout: "dual";
    /** Rail A runs top to bottom, rail B bottom to top. */
    headA: string;
    headB: string;
    rows: DiagramRow[];
    /** Rail B returns to rail A's start: draw a turn at the top. */
    loopTop: boolean;
    /** The far end is one station: draw a turn at the bottom. */
    loopBottom: boolean;
}

export interface SingleDiagram {
    layout: "single";
    stops: RouteStop[];
}

export type Diagram = DualDiagram | SingleDiagram;

/** "Sbr. Jln. Makam 2" -> "makam": what a stop and its opposite share. */
const placeKey = (name: string) =>
    removeOppStopPrefix(name)
        .toLowerCase()
        .replace(/^(jln?\.?|gg\.?)\s+/, "")
        .replace(/\s+(arah\s+\S+|jalur\s+\S+|\d+|[ivx]+)$/, "")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();

const samePlace = (a: RouteStop, b: RouteStop) =>
    placeKey(a.stop_name) === placeKey(b.stop_name) &&
    haversine(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon) < 400;

/**
 * Consecutive entries that are one station (twin platforms at a terminus or
 * a turnaround) collapse into one stop.
 */
export const dedupeAdjacent = (stops: RouteStop[]) => {
    const out: RouteStop[] = [];
    for (const s of stops) {
        const prev = out[out.length - 1];
        if (
            prev &&
            removeOppStopPrefix(prev.stop_name).toLowerCase() ===
                removeOppStopPrefix(s.stop_name).toLowerCase()
        )
            continue;
        out.push(s);
    }
    return out;
};

/**
 * Longest-common-subsequence alignment of the two directions, so matching
 * places land on the same row and stops served one way only sit on one rail.
 * Routes are at most ~80 stops a side, so the O(n*m) table is trivial.
 */
export const alignDirections = (
    A: RouteStop[],
    B: RouteStop[]
): DiagramRow[] => {
    const n = A.length;
    const m = B.length;
    const match = (i: number, j: number) =>
        A[i].stop_id === B[j].stop_id || samePlace(A[i], B[j]);

    const d: Int32Array[] = Array.from(
        { length: n + 1 },
        () => new Int32Array(m + 1)
    );
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            d[i][j] = match(i, j)
                ? d[i + 1][j + 1] + 1
                : Math.max(d[i + 1][j], d[i][j + 1]);

    const rows: DiagramRow[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (match(i, j) && d[i][j] === d[i + 1][j + 1] + 1) {
            rows.push(
                A[i].stop_id === B[j].stop_id
                    ? { kind: "shared", stop: A[i] }
                    : { kind: "pair", a: A[i], b: B[j] }
            );
            i++;
            j++;
        } else if (d[i + 1][j] >= d[i][j + 1]) {
            rows.push({ kind: "a", a: A[i++] });
        } else {
            rows.push({ kind: "b", b: B[j++] });
        }
    }
    while (i < n) rows.push({ kind: "a", a: A[i++] });
    while (j < m) rows.push({ kind: "b", b: B[j++] });
    return rows;
};

const stopsOf = (detail: RouteDetail, v: RouteVariant) => {
    const byId = new Map(detail.stops.map((s) => [s.stop_id, s]));
    return dedupeAdjacent(
        v.stopIds
            .map((id) => byId.get(id))
            .filter((s): s is RouteStop => !!s)
    );
};

/**
 * The two directions of the route's main service, as two stop lists where
 * B is reversed so both read from the same end. Two main patterns give the
 * two directions directly; a single main pattern that is a loop is split at
 * its far terminal (see routeTerminals).
 */
const directionsOf = (
    detail: RouteDetail
): { A: RouteStop[]; B: RouteStop[]; headA: string; headB: string } | null => {
    const variants = detail.variants ?? [];
    const trunks = variants.filter((v) => v.kind === "utama");
    if (trunks.length >= 2) {
        let A = stopsOf(detail, trunks[0]);
        let B = stopsOf(detail, trunks[1]);
        // A "main" pattern can itself be a full loop that comes back to
        // its start (JAK.50: Kalideres -> Puri Kembangan -> Kalideres, 129
        // stops, beside a 56-stop one-way return). Set against the other
        // direction whole, it doubles the diagram. Keep only the leg the
        // other direction does not already cover: up to the point where it
        // reaches the other direction's start.
        const leg = (loop: RouteStop[], other: RouteStop[]) => {
            if (loop.length < 3 || !samePlace(loop[0], loop[loop.length - 1]))
                return loop;
            const k = loop.findIndex(
                (s, i) => i > 0 && (s.stop_id === other[0]?.stop_id || samePlace(s, other[0]))
            );
            return k > 0 && k < loop.length - 1 ? loop.slice(0, k + 1) : loop;
        };
        A = leg(A, B);
        B = leg(B, A);
        return {
            A,
            B: B.reverse(),
            headA: trunks[0].headsign,
            headB: trunks[1].headsign,
        };
    }
    if (trunks.length === 1) {
        const s = stopsOf(detail, trunks[0]);
        if (s.length < 2) return null;

        // Some routes file their whole return under the same direction_id,
        // so the sync classifies it as a diversion (route 5: "Ancol" is the
        // main pattern, "Kampung Melayu" an "alihan"). The return is the
        // most frequent non-loop pattern running the opposite way: starts
        // near the main pattern's end and ends near its start.
        const near = (a: RouteStop, b: RouteStop) =>
            a.stop_id === b.stop_id || samePlace(a, b);
        const back = variants
            .filter((v) => v !== trunks[0] && v.kind !== "putaran")
            .map((v) => ({ v, st: stopsOf(detail, v) }))
            .filter(
                ({ st }) =>
                    st.length > 1 &&
                    near(st[0], s[s.length - 1]) &&
                    near(st[st.length - 1], s[0])
            )
            .sort(
                (x, y) =>
                    (x.v.headwaySecs ?? Infinity) -
                        (y.v.headwaySecs ?? Infinity) ||
                    y.st.length - x.st.length
            )[0];
        if (back) {
            return {
                A: s,
                B: back.st.reverse(),
                headA: trunks[0].headsign,
                headB: back.v.headsign,
            };
        }

        if (s.length < 3) return null;
        const loops =
            removeOppStopPrefix(s[0].stop_name).toLowerCase() ===
            removeOppStopPrefix(s[s.length - 1].stop_name).toLowerCase();
        if (!loops) return null;
        const far = routeTerminals(detail.route_long_name, s)[1];
        const k = far ? s.findIndex((x) => x.stop_id === far.stop_id) : -1;
        if (k <= 0 || k >= s.length - 1) return null;
        return {
            A: s.slice(0, k + 1),
            B: s.slice(k).reverse(),
            headA: far.stop_name,
            headB: s[0].stop_name,
        };
    }
    return null;
};

/**
 * The dual diagram for the route's main service, or null when the feed
 * gives it only one direction.
 */
export const dualDiagramFor = (detail: RouteDetail): DualDiagram | null => {
    const dirs = directionsOf(detail);
    if (!dirs) return null;
    const rows = alignDirections(dirs.A, dirs.B);

    const isSame = (r: DiagramRow | undefined) =>
        r?.kind === "shared" || r?.kind === "pair";
    return {
        layout: "dual",
        headA: dirs.headA,
        headB: dirs.headB,
        rows,
        loopTop: isSame(rows[0]),
        loopBottom: isSame(rows[rows.length - 1]),
    };
};

/** One pattern as a plain line, platform twins merged. */
export const singleDiagramFor = (
    detail: RouteDetail,
    v: RouteVariant
): SingleDiagram => ({ layout: "single", stops: stopsOf(detail, v) });
