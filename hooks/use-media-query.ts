"use client";

import { useSyncExternalStore } from "react";

/**
 * Live result of a CSS media query.
 *
 * useSyncExternalStore rather than useState + useEffect: the first client
 * render already has the right answer, so a wide screen never flashes the
 * narrow layout first. The server snapshot is `false` (narrow), which only
 * matters for the server-rendered HTML.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const mql = window.matchMedia(query);
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        },
        () => window.matchMedia(query).matches,
        () => false
    );
}
