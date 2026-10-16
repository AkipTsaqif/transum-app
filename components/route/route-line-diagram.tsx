"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { removeOppStopPrefix } from "@/utils/helper-fn";
import type { DiagramRow, DualDiagram } from "@/utils/line-diagram";
import type { RouteStop } from "@/utils/types/gtfs";

/**
 * Stop-by-stop strip maps for the route card.
 *
 * Rails are absolutely positioned per row and butt together (top 0 / bottom 0)
 * so a row of any height -- one line or a wrapped two-line name -- keeps the
 * line continuous. Every dot is centred on DOT_Y, the middle of the first
 * text line (py-1 + half of the 16px line height).
 */
const DOT_Y = 12;

type OnStop = (stop: RouteStop) => void;

interface Mark {
    x: number;
    y: number;
    dir: "down" | "up";
}

/**
 * Chevrons midway between consecutive stops on each rail, measured from the
 * rendered dots rather than computed from row counts.
 *
 * Rows are not equal height -- a long name wraps to two lines -- and a rail
 * can pass many rows with no dot of its own (the other direction takes other
 * streets), so counting rows put some chevrons tens of px off-centre. Reading
 * the real dot positions puts each exactly halfway, however tall the rows
 * between them are. Re-measured whenever the list resizes, since wrapping
 * changes with width.
 *
 * Dots declare their rail in `data-dot` ("a", "b", or "ab" for a shared stop
 * that sits on both); the down/up direction follows the rail.
 */
function useChevronMarks(dep: unknown) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [marks, setMarks] = useState<Mark[]>([]);

    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;

        const measure = () => {
            const box = root.getBoundingClientRect();
            const rails: Record<string, { x: number; ys: number[] }> = {};

            const add = (id: string, y: number) => {
                if (!rails[id]) {
                    // x of the rail itself, not of a wide shared node.
                    const rail = root.querySelector<HTMLElement>(
                        '[data-rail="' + id + '"]'
                    );
                    if (!rail) return;
                    const rr = rail.getBoundingClientRect();
                    rails[id] = { x: rr.left + rr.width / 2 - box.left, ys: [] };
                }
                rails[id].ys.push(y);
            };

            for (const el of root.querySelectorAll<HTMLElement>("[data-dot]")) {
                const r = el.getBoundingClientRect();
                const y = r.top + r.height / 2 - box.top;
                const which = el.dataset.dot ?? "";
                if (which === "ab") {
                    add("a", y);
                    add("b", y);
                } else add(which, y);
            }

            const next: Mark[] = [];
            for (const [id, { x, ys }] of Object.entries(rails)) {
                ys.sort((p, q) => p - q);
                for (let i = 0; i < ys.length - 1; i++) {
                    next.push({
                        x,
                        y: (ys[i] + ys[i + 1]) / 2,
                        // Rail B is the return trip: it runs up the page.
                        dir: id === "b" ? "up" : "down",
                    });
                }
            }
            setMarks(next);
        };

        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(root);
        return () => ro.disconnect();
    }, [dep]);

    return { ref, marks };
}

/**
 * The chevron overlay, absolutely positioned over the whole list.
 *
 * Needs `z-10`: it is the first child (so the marks measure the list that
 * follows), and the rails and dots are positioned elements too, so with no
 * z-index they paint later in tree order and cover it -- the chevrons were
 * there but entirely hidden behind the rail.
 */
function Chevrons({ marks }: { marks: Mark[] }) {
    return (
        <>
            {marks.map((m, i) => {
                const Icon = m.dir === "down" ? ChevronDown : ChevronUp;
                return (
                    <Icon
                        key={i}
                        aria-hidden
                        data-chevron={m.dir}
                        size={10}
                        strokeWidth={3.5}
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.6)]"
                        style={{ left: m.x, top: m.y }}
                    />
                );
            })}
        </>
    );
}

/** A stop name that focuses the map on the stop. */
function StopName({
    stop,
    end,
    align = "left",
    onStop,
    focusedId,
}: {
    stop: RouteStop;
    end: boolean;
    align?: "left" | "right";
    onStop: OnStop;
    focusedId?: string | null;
}) {
    const focused = focusedId === stop.stop_id;
    return (
        <button
            type="button"
            onClick={() => onStop(stop)}
            title={`Fokus ke ${stop.stop_name}`}
            className={`w-full cursor-pointer rounded px-1 py-1 text-xs leading-4 font-pt-sans transition-colors hover:bg-white/10 ${
                align === "right" ? "text-right" : "text-left"
            } ${end ? "font-bold text-white" : "text-white/85"} ${
                focused ? "bg-white/15 text-white" : ""
            }`}
        >
            {stop.stop_name}
        </button>
    );
}

/**
 * A dot on a rail. Ends are larger. `x` is the rail's horizontal centre in
 * the rail column.
 */
function Dot({
    x,
    end,
    color,
    rail,
}: {
    x: string;
    end: boolean;
    color: string;
    rail: "a" | "b";
}) {
    return (
        <span
            data-dot={rail}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ${
                end ? "h-3.5 w-3.5 border-[3px]" : "h-2.5 w-2.5 border-2"
            }`}
            style={{ left: x, top: DOT_Y, borderColor: color }}
        />
    );
}

/** One vertical rail segment through a row, trimmed at the ends. */
function Rail({
    x,
    color,
    from,
    to,
    rail,
}: {
    x: string;
    color: string;
    rail: "a" | "b";
    /** Start the rail at the dot instead of the row top. */
    from: "top" | "dot";
    /** End the rail at the dot instead of the row bottom. */
    to: "bottom" | "dot";
}) {
    return (
        <span
            data-rail={rail}
            className="absolute w-1 -translate-x-1/2"
            style={{
                left: x,
                backgroundColor: color,
                top: from === "dot" ? DOT_Y : 0,
                ...(to === "dot"
                    ? { height: Math.max(0, DOT_Y - (from === "dot" ? DOT_Y : 0)) }
                    : { bottom: 0 }),
            }}
        />
    );
}

/** Single line: one direction, top to bottom. */
export function SingleLine({
    stops,
    color,
    onStop,
    focusedId,
}: {
    stops: RouteStop[];
    color: string;
    onStop: OnStop;
    focusedId?: string | null;
}) {
    const { ref, marks } = useChevronMarks(stops);
    return (
        <div ref={ref} className="relative">
            <Chevrons marks={marks} />
            <ol className="px-3" data-testid="stop-line">
                {stops.map((s, i) => {
                    const first = i === 0;
                    const last = i === stops.length - 1;
                    return (
                        <li
                            key={s.stop_id + "-" + i}
                            className="flex items-start gap-1.5"
                        >
                            <span
                                aria-hidden
                                className="relative w-4 shrink-0 self-stretch"
                            >
                                {stops.length > 1 && (
                                    <Rail
                                        rail="a"
                                        x="50%"
                                        color={color}
                                        from={first ? "dot" : "top"}
                                        to={last ? "dot" : "bottom"}
                                    />
                                )}
                                <Dot
                                    x="50%"
                                    end={first || last}
                                    color={color}
                                    rail="a"
                                />
                            </span>
                            <span className="min-w-0 flex-1">
                                <StopName
                                    stop={s}
                                    end={first || last}
                                    onStop={onStop}
                                    focusedId={focusedId}
                                />
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

/**
 * Both directions. Column A (left names, left rail) reads top to bottom;
 * column B (right rail, right names) reads bottom to top, matching how the
 * bus returns. A shared median stop is one node spanning both rails; an
 * opposite pair is two dots joined by a dotted link.
 */
export function DualLine({
    diagram,
    color,
    onStop,
    focusedId,
}: {
    diagram: DualDiagram;
    color: string;
    onStop: OnStop;
    focusedId?: string | null;
}) {
    const { rows } = diagram;
    // Indonesia drives on the left, so a bus heading down the page (rail A)
    // keeps to its left, which is the right-hand side of the diagram; the
    // return (rail B, heading up) is on the left. XL / XR are the left and
    // right rail positions.
    const XL = "35%";
    const XR = "65%";
    const { ref, marks } = useChevronMarks(diagram);

    const aStop = (r: DiagramRow) =>
        r.kind === "shared" ? r.stop : r.kind === "pair" || r.kind === "a" ? r.a : null;
    const bStop = (r: DiagramRow) =>
        r.kind === "shared" ? r.stop : r.kind === "pair" || r.kind === "b" ? r.b : null;

    // Where each rail has its first and last dot, so it is trimmed there
    // instead of trailing past the end of the route.
    const firstA = rows.findIndex((r) => aStop(r));
    const lastA = rows.length - 1 - [...rows].reverse().findIndex((r) => aStop(r));
    const firstB = rows.findIndex((r) => bStop(r));
    const lastB = rows.length - 1 - [...rows].reverse().findIndex((r) => bStop(r));

    const railFor = (i: number, first: number, last: number) =>
        i < first || i > last
            ? null
            : {
                  from: i === first ? ("dot" as const) : ("top" as const),
                  to: i === last ? ("dot" as const) : ("bottom" as const),
              };

    return (
        <div data-testid="stop-line-dual" ref={ref} className="relative">
            <Chevrons marks={marks} />
            <div className="grid grid-cols-[1fr_44px_1fr] gap-x-1 px-3 pb-1 text-[10px] text-white/45">
                <span className="truncate text-right">{"\u2191 " + diagram.headB}</span>
                <span />
                <span className="truncate">{"\u2193 " + diagram.headA}</span>
            </div>
            <ol className="px-3">
                {rows.map((r, i) => {
                    const a = aStop(r);
                    const b = bStop(r);
                    const ra = railFor(i, firstA, lastA);
                    const rb = railFor(i, firstB, lastB);
                    const end = i === 0 || i === rows.length - 1;
                    const shared = r.kind === "shared";
                    return (
                        <li
                            key={i}
                            className="grid grid-cols-[1fr_44px_1fr] items-start gap-x-1"
                        >
                            <span className="min-w-0">
                                {/* Left column: the return direction (rail
                                    B). Only a name that differs from the
                                    other side ("Kebon Sirih Arah Selatan")
                                    or a one-way stop is printed here; an
                                    identical twin is named once, on the
                                    right, and a shared stop is one place. */}
                                {b &&
                                    !shared &&
                                    (r.kind !== "pair" ||
                                        removeOppStopPrefix(r.a.stop_name) !==
                                            removeOppStopPrefix(r.b.stop_name)) && (
                                        <StopName
                                            stop={b}
                                            end={end}
                                            align="right"
                                            onStop={onStop}
                                            focusedId={focusedId}
                                        />
                                    )}
                            </span>
                            <span aria-hidden className="relative self-stretch">
                                {ra && <Rail rail="a" x={XR} color={color} {...ra} />}
                                {rb && <Rail rail="b" x={XL} color={color} {...rb} />}
                                {shared ? (
                                    // One platform used both ways (median
                                    // BRT): a single node bridging the rails.
                                    <span
                                        data-dot="ab"
                                        className="absolute -translate-y-1/2 rounded-full border-2 bg-white"
                                        style={{
                                            left: `calc(${XL} - 7px)`,
                                            width: `calc(${XR} - ${XL} + 14px)`,
                                            top: DOT_Y,
                                            height: end ? 14 : 12,
                                            borderColor: color,
                                            borderWidth: end ? 3 : 2,
                                        }}
                                    />
                                ) : (
                                    <>
                                        {r.kind === "pair" && (
                                            <span
                                                className="absolute border-t-2 border-dotted border-white/40"
                                                style={{
                                                    left: XL,
                                                    width: `calc(${XR} - ${XL})`,
                                                    top: DOT_Y - 1,
                                                }}
                                            />
                                        )}
                                        {a && (
                                            <Dot x={XR} end={end} color={color} rail="a" />
                                        )}
                                        {b && (
                                            <Dot x={XL} end={end} color={color} rail="b" />
                                        )}
                                    </>
                                )}
                            </span>
                            <span className="min-w-0">
                                {/* Right column: the outward direction (rail
                                    A), which always carries the name. */}
                                {a && (
                                    <StopName
                                        stop={a}
                                        end={end}
                                        onStop={onStop}
                                        focusedId={focusedId}
                                    />
                                )}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
