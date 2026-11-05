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

## Behaviour boundaries confirmed

No extrapolation: every marker pose is computed from the two surrounding observations (or the road between them). Unknown heading means no arrow. Below z12 nothing animates. A shape that does not explain the move is not used.

## Cleanup

Dev server and sidecar stopped; no listeners on3000/8787. `.scratch/` diagnostics are local and not to be committed.

## Not covered

No long-duration soak, no synthetic high-load profile, no measurement of CPU on low-end phones, no device-clock edge cases beyond the existing normalizer tests.
