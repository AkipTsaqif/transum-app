# "Semua Moda" verification

## Scope
One extra picker entry, "Semua Moda", as the first item of the Jakarta
group: it is the overview of the five single modes listed under it. It is a client-side composition of the existing per-mode
datasets, not a new dataset and not a new API route: every route and station
still belongs to exactly one mode and is fetched from that mode's endpoint.

Choices confirmed with the owner:
- Bus faint, rail bold. The bus network draws thin and faint underneath; KRL,
  MRT and both LRTs draw bold on top.
- Bus stops stay lazy: rail stations from z9, the 6,437 bus stops only from
  z12. Station names appear at z12; bus stop names wait for z14 so they do not
  become an unreadable smear.
- Sidebar grouped by mode, rail first, Transjakarta last; search filters
  across everything.

## Correct-identity rules
- Route ids are only unique within a mode, so selection and hover use a
  mode-qualified key (`krl:A`, `gtfs:1`, `lrtj:CB`). `splitRouteKey` splits on
  the first colon, so a GTFS id containing a colon still round-trips.
- `dataModeFor(view, key)` returns the dataset a request belongs to: the view's
  own mode, or in the all view the selected route's mode, or null.
- A station opens against the dataset it came from: search hits and map dots
  carry `mode`, and the opened station remembers it (`stationMode`) so
  "Tampilkan rute di peta" fetches its routes from the same dataset.

## Checks
- `tsx --test utils/*.test.ts`: 57 passed. New: key round-trips, per-mode
  grouping order, overview merge ordering (bus first so rail paints on top),
  stop-layer tagging without mutating inputs, mode isolation, and a style-spec
  validation of the overview paint.
- `tsc --noEmit` and `npm run build` pass. No new API route exists, so the
  build output is unchanged.
- Firefox (production build, port 3007): the picker lists all five modes plus
  Semua Moda; the title reads "Transum App - Semua Moda"; the sidebar shows
  headings KRL Commuter Line, MRT Jakarta, LRT Jakarta, LRT Jabodebek,
  Transjakarta with 249 routes; the overview renders 1,038 bus and 33 rail
  features with the bus at opacity 0.35 and width 1-2.5 against rail 3.
  Station dots: 99 rail-only at z9.5, 1,206 (1,180 bus + 26 rail) at z13.
  Station names: none at z9.5 and z11, 51 rail names at z12.2, then 7 rail +
  228 bus names at z14.2. The picker order is Semua Moda, Transjakarta, KRL
  Commuter Line, MRT Jakarta, LRT Jakarta, LRT Jabodebek.
  Selecting a KRL route from the grouped list loads its detail and draws it.
- No dataset changed; `data/` is untouched.

## Bug found and fixed
Stops were unclickable in Semua Moda. The map's station-click callback carried
only name and coordinates, and the page needed a dataset to resolve against;
with no dataset selected in the all view the handler bailed out and the click
was silently dropped. The click now carries the symbol's `mode`, and
`resolveStationMode()` in utils/all-modes.ts decides: explicit mode first, the
view's own mode second, otherwise the nearest loaded station of that name.
Proximity matters because two systems can share a name (Manggarai exists on
both KRL and LRT Jakarta).

## Bug caught before shipping
The first build silently dropped the overview layer. MapLibre allows a zoom
expression only at the top level of `step`/`interpolate`; the all-view paint
nested the bus width ramp inside `case`, so `addLayer` failed. The paint now
lives in `overviewLinePaint()` and a test validates it with
`validateStyleMin`, which fails on exactly that mistake.

## Notes
- Lint is still blocked: typescript-eslint rejects TypeScript 7.0.
