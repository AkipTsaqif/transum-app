# Transjakarta landing view and automatic live route badges

Branch feat/transjakarta-live, working changes on top of previous uncommitted live feature. No commit/push/deploy requested.

## Mechanical gate
Single run: `npx tsc --noEmit && npx tsx --test utils/*.test.ts live/*.test.ts` => exit0,93 tests/pass93/fail0. `git diff --check` => clean.
New scope tests: absent/invalid/reversed/duplicate/world-size bbox rejected; route+bbox ambiguity rejected; valid viewport projects multiple routes but not out-of-bounds vehicles; exact route filtering retained; static GTFS short-name/colour and contrast used instead of upstream colour; world-scale map yields bounded valid query. HTTP integration test verifies actual viewport SSE frame routeId:null, scope identity, no outside vehicle.

## Browser evidence (Edge via Puppeteer, actual sidecar)
Desktop1440x900 and phone390x844 touch:
- Fresh page picker reads Transjakarta, no route selected, live toggle already true.
- Receives bbox-scoped SSE without button press or route selection.
- MapLibre live-bus-badge rendered across multiple routes. Examples: route1=#D62126 with white text; P11=#FFFF6D with black text. Raster icon key includes route label and colour, pixelRatio2; arrow layer absent. No fleet ID text in map badge.
- Camera unchanged while snapshots arrive: desktop z9.8977778761; phone z8.1770166767. Live geometry excluded from route fit.
- Pan changes bbox query after movement settles.
- Selecting route1 changes query to route=1 and rendered route-code set becomes [1]. Live state remains enabled with no second activation.
- Tap/click badge opens bus details inside viewport, receipt age present.
- Opt-out then clear route: toggle remains false, no forced reconnection.
- Bus layers stay above static routes/stops. Browser runtime errors none, console errors none.

Rendered feature counts vary during capture and can include tiled duplicates: they are evidence of rendering, NOT a unique fleet total. No screenshots taken.

## Runtime/config
Local Next3000 and sidecar8787 started with process-only flags true to allow user preview. No .env.local written. Service sample env keeps deployment/access gates false; once explicitly configured, display is default-on. Still experimental, no public deployment or realtime licence assumption. ESLint remains baseline blocked by TS7/parser incompatibility. No production build run alongside dev.
