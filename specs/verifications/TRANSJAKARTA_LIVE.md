# Experimental live buses — verification

Branch: feat/transjakarta-live. Uncommitted; no deployment or push.

## Mechanical gate (single contiguous final run)
Command: `npx tsc --noEmit && npx tsx --test utils/*.test.ts live/*.test.ts`
Exit:0. Output: tests88, pass88, fail0; tsc produced no errors. Baseline77 tests +11 added live tests. `git diff --check` clean. `data/gtfs`, `lib/gtfs.ts` and `app/api` unchanged.

No production build run because next dev shares .next and must not be corrupted. ESLint blocked BEFORE feature implementation by TypeScript7/parser mismatch; tracked in specs/bugs/BUG-live-lint-toolchain.md, not reported as passed.

## Browser: real sidecar/feed, image-free
Browser: headless Edge, Puppeteer. Native local Node sidecar port8787, Next local dev3000 with feature flags enabled only in child-process environment. No production flags or .env.local changed.

Selected Transjakarta route1, explicitly activated live layer. Assertions use DOM geometry and MapLibre queryRenderedFeatures:

| Check | Desktop1440x900 | Phone390x844/touch |
|---|---|---|
| Before/after settled camera zoom during updates |12.2579969 unchanged|11.1653858 unchanged|
| Rendered bus dots (short window, NOT total fleet)|2 then6|7 then7|
| Layers above route pins|dot,bearing,hit|dot,bearing,hit|
| Tap/click marker opens bus card|pass|pass|
| Accessible bus list opens same card|pass|pass|
| Card within viewport|pass, width288px|pass, width374px|
| Close hit target|44px|44px|
| Horizontal document overflow|none|none|
| Switch route clears card and resets opt-in|pass|pass|
| Browser runtime errors|none|none|

Additional phone browser run: offline event -> reconnecting; restored connectivity -> connected; opt-out removes bus list; no page errors. The offline event test exposed a missing navigator offline handler; fixed and rerun green.

## Backend / pure tests
Zero raw lat OR lon rejected even if snapped looks valid; invalid raw bounds rejected; remote/zero snapped falls back to raw; IDs matched exactly; seconds/ms timestamp normalization; per-vehicle relative skew correction; duplicate/equal/backward source samples don't refresh TTL; old retained initial state rejected;90s expiry; bounded latest-state map; one upstream for two viewers; last-viewer cleanup; obsolete callbacks ignored; retry after connector failure; invalid/missing route400; wrong Origin403; disabled service503 without broker connection; SSE snapshot/heartbeat/no-store/no-buffer headers and disconnect cleanup.

## Cleanup
All test browser instances closed. Sidecar health before stop: clients0. Sidecar stopped; no8787 listener remains. Local Next dev restored with feature disabled; GET /200. No commits or pushes. .scratch diagnostics remain local and are not to be committed.

## Remaining gates / limitations
- Realtime publication/access terms unresolved; GTFS Static licence not extended to MQTT. Disabled by default.
- No ETA/occupancy or true device-time-age promises.
- Relative clock progression cannot prove a queued stream isn't delayed. Adjusted/unverified clock label retained.
- No serverless/multireplica deployment claim, formal load test, midnight/device-reboot recovery validation or long-haul soak.
- Source clock regression is conservatively ignored until source catches up or90s TTL expires; no unsound auto-rebase.
- Public reverse proxy TLS/rate limits/process supervision are documented, not deployed.
