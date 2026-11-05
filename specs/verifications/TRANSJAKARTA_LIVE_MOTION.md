# Live bus motion — verification

Branch `feat/transjakarta-live`. Uncommitted. No screenshots; all evidence is unit tests, DOM/source measurement and diff tracing.

## Mechanical gate

Single run: `npx tsc --noEmit && npx tsx --test utils/*.test.ts live/*.test.ts` → exit0, **139 tests / pass139 / fail0** (baseline119 +20 new). `git diff --check` clean.

Previous gate caveat unchanged: ESLint cannot start under TypeScript7 (`specs/bugs/BUG-live-lint-toolchain.md`), so lint is reported blocked, not passed.

## Unit coverage added

- `utils/transjakarta-live.test.ts`: invalid/missing bearing becomes `null` (0 and 270/90 still work), `tripId` carried and capped at80 chars.
- `utils/live-motion.test.ts`: glide duration equals the bus's own interval and clamps to1-6 s; first fix snaps; 15 s gap snaps; stopped bus holds heading under5 m of drift (wobble sequence 92/88/91/89/87 stays at90); null heading never becomes north; supplied shape makes the mid-glide pose sit on the corner (>60 m from the chord) and the heading turn with the road; no shape or a shape1 km away keeps the straight glide.
- `utils/live-path.test.ts`: real route-1 shape (`1-R07_shp`) — 96%-shape following through a turn, ≤30 m offset trust boundary, backwards travel refused, U-shaped fork detour refused, degenerate shapes fall back, heading north→east through a corner, uniform distance sampling.
- `utils/live-shapes.test.ts`: trip→shape resolution, unknown trip/route returns nothing instead of guessing, single-shape fallback, LRU bound40 with recently-used retention, one-point shapes ignored.

## Browser (headless Edge, real sidecar + real feed, 1440x900 and 390x844)

Instrumented `CanvasRenderingContext2D.measureText` (badge font only), `GeoJSONSource.updateData` and `setData`.

| Check                                                  | Result                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing zoom (z9.9) tracks a fixed 25-bus set for1.2 s | ~1 pose per bus (snapped), **4** `updateData` calls                                                                                         |
| Above floor (z14)                                      | **113** `updateData` calls in1.2 s, diffs of ~19-30 moved buses, only17 `setData` in the whole session (membership/appearance, not frames)  |
| One bus's pushed poses                                 | **39 frames, 38 distinct poses, 39/39 on the route shape**                                                                                  |
| `measureText` during animation                         | **0** calls (width cache)                                                                                                                   |
| Headings observed                                      | 14°-247°, i.e. following the road, not the chord                                                                                            |
| Camera during live updates                             | zoom9.897778 and centre (-6.321932,106.904558) unchanged over2.5 s                                                                          |
| Phone390x844 (z8.18)                                   | 3,220 badges render, no horizontal overflow, arrow layer present, no `null`-heading arrows invented, tap opens the card inside the viewport |
| Runtime/console errors                                 | none                                                                                                                                        |

Note: `querySourceFeatures` is tile-quantized, so it cannot evidence a sub-pixel glide; the diff trace above is the authoritative measurement of what the map receives.

## CORRECTION AND RE-MEASUREMENT (same branch, after the numbers above)

The `updateData` calls counted above only proved that calls were made. `LiveBusLayers` was passing full GeoJSON Features in `diff.update`, while MapLibre6.12 applies `GeoJSONFeatureDiff` (`id`, `newGeometry`, `addOrUpdateProperties`), so those writes were **ignored by the worker** and the visible movement came from the once-per-second React `setData`. Earlier rows claiming on-shape positions from tile queries measured the snapshot, not the animation. Bug: `specs/bugs/BUG-live-frame-diffs.md`.

Fixes: typed `liveFeatureDiff()` writes, exact coordinates (no minimum step / no six-decimal rounding), 60 fps with the frame remainder preserved (measured ~57, not45), React `setData` no longer fires on position-only snapshot ticks, `fadeDuration: 0` so symbol placement adopts each anchor immediately instead of the300 ms fade, and bounded shape loading (visible vehicles only,4 concurrent,30 s failure cooldown, no request per snapshot).

Re-measured with a single deterministic synthetic `EventSource` vehicle inside a normal browser session (the sidecar and dataset are untouched; only that page instance is faked):

| Check                                      | Desktop1440x900                       | Phone390x844    |
| ------------------------------------------ | ------------------------------------- | --------------- |
| Per-frame source writes                    | **57.0/s**                            | 56.3/s          |
| Writes applied by the worker               | 57.0/s                                | 56.3/s          |
| Distinct actually-rendered positions in3 s | **168** (was11)                       | 168             |
| Full `setData` during animation            | **0** (was once per second)           | 0               |
| `getData()` final geometry vs last sample  | within0.001 deg                       | within0.001 deg |
| Below zoom12                               | exact snapshot position, no animation | same            |
| Camera during updates                      | unchanged (z16, same centre)          | same            |
| Failed shape route over6.5 s of snapshots  | **1** request, not one per second     | -               |
| Low-zoom shape requests                    | **0**                                 | -               |
| Runtime errors                             | none                                  | none            |

Unit suite at the end: **144 tests pass**, tsc clean.

## Behaviour boundaries confirmed

No extrapolation: every marker pose is computed from the two surrounding observations (or the road between them). Unknown heading means no arrow. Below z12 nothing animates. A shape that does not explain the move is not used.

## Cleanup

Dev server and sidecar stopped; no listeners on3000/8787. `.scratch/` diagnostics are local and not to be committed.

## Not covered

No long-duration soak, no synthetic high-load profile, no measurement of CPU on low-end phones, no device-clock edge cases beyond the existing normalizer tests.
