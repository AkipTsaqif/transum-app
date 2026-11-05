# Live marker frame writes ignored / repeated dev route work

## Reproduction and root cause
At HEAD412dfef, LiveBusLayers casts its GeoJSON source to updateData(diff:unknown) and puts full Feature objects in diff.update. Installed MapLibre6.12 expects GeoJSONFeatureDiff: id,newGeometry,addOrUpdateProperties. applySourceDiff ignores entries without newGeometry or property edits. Calls were counted in earlier verification, but that did NOT prove rendered positions changed. Once-per-second React data replaces the source, making animation look like low FPS. Correct previous evidence claims accordingly.

Additionally frame gate caps updates at30fps and its pose key rounds coordinates to six decimals (~0.11m); increasing precision alone cannot fix ignored geometry diffs.

Shape hook can repeatedly request failed routes, churn an LRU40 with >40 viewport routes, and continue pumping after zoom-out. Those route fetches can trigger Next on-demand compilation on first use and unnecessary HTTP work afterwards. No recurring compile should be attributed to MQTT itself. Stale .next/dev caused HTML404s this run; clearing only stopped dev cache restored200; do not conflate that with compile behavior.

## Fix / verification
- Use typed MapLibre GeoJSONFeatureDiff updates; regression test applying the public diff contract and browser assertion of actual source geometry + rendered features.
- Exact coordinates, no minimum pixel distance;60fps cap, retain low-zoom/reduced-motion/staleness guards, no extrapolation.
- Single owner of position updates: no full setData every source snapshot solely because coordinates changed; reset explicitly on membership/appearance/style change. Catch async worker failures.
- Bounded shape scheduler: at most4 concurrent, cooldown failures, no fetch churn when cache working set40 is full, filter to visible vehicles at zoom>=12, cancel obsolete work.
- Unit suite+tsc, browser synthetic moving bus rendered-position samples on desktop/phone, source applied geometry versus intended geometry, update counters, no camera movement, repeated shape fetch checks. Stop assistant-owned dev/listener afterwards; don't commit/push without request.
