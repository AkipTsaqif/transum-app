# Transjakarta live buses — first slice

## Updated defaults (user request)
- Landing view is Transjakarta (`gtfs`), not Jakarta all modes.
- When the live feature is configured, live display starts enabled; no route must be selected. Explicit operator/deployment flags still control whether the service exists, not each route selection.
- No selected route: stream only vehicles within the settled map viewport. Selected gtfs route: retain exact route filtering. Other operators suspend live. Viewer opt-out persists across route changes within the session.
- Bounded SSE requests require either a known route or a finite valid bbox. No unconstrained fleet response. Pan/zoom updates viewport after movement settles; live data never changes camera bounds.
- Vehicle badges show genuine GTFS route short name in GTFS route colour (readable contrast), not arrow or fleet number. Fleet identity remains in tap card/list.
- Add tests for bbox validation/filtering, scope changes, static route colour identity, defaults, marker rendering and route/viewport transitions.

## Scope
On `feat/transjakarta-live`, not main. The user approved a validation spike followed by selected-route live buses and confirmed VPS/long-running Node hosting. No deployment, commit or push requested at that point, no ETAs, occupancy, tracking history, or synthetic schedules in this slice.

**This commit is the frontend only.** The MQTT listener and SSE server (`live/`, `utils/transjakarta-live.ts`, MQTT.js dependency, `npm run live`) are a separate long-running service and are deliberately NOT part of it. The frontend consumes the SSE contract documented in `docs/transjakarta-live-frontend.md` and cannot produce live positions alone.

## Decisions
- One standalone Node sidecar using MQTT.js. First viewer starts one subscriber; idle shutdown closes it. Not a Next route singleton and no change to static API caching.
- Public-facing route-filtered SSE at `/live/vehicles?route=<GTFS id>`, behind a same-origin VPS reverse proxy. Local development can configure an explicit origin. Only known GTFS routes accepted, no unfiltered stream.
- Upstream `wss://mqtt.tj.co.id:8084/mqtt`, MQTT 3.1.1, `mqttjs_` unique IDs, `/mobile_armada/#`, QoS0, no tokens or credentials. Bounded exponential retry and per-process connection sharing.
- Experimental UI/sidecar both explicitly opt-in and disabled by default. Access does not establish republication rights. The official CC BY 4.0 grant names GTFS Static only: https://ppid.transjakarta.co.id/informasi/berkala . No production enablement assumed.
- Drop any raw lat OR lon equal to zero, non-finite, out-of-range or implausibly outside the network. Validate snapped position independently; fall back to raw if snapped invalid.
- Timestamp units measured separately; never blanket-shift all source timestamps. Preserve source timestamp and observed skew; use receiver time and source progression for freshness. Display age as received, not GPS measurement age. No ETA units assumed.
- TTL initially 90 seconds based on bounded observed update cadence; stale at 30 seconds, prune at 90. Operational defaults must be documented and tested; no false assertion of service completeness.
- Sidecar protocol: named SSE `snapshot` event, data `{routeId, status, serverTime, vehicles: LiveVehicle[]}` (full filtered state, throttled to one/second). Comments heartbeat. `status` is connecting/live/reconnecting/disconnected. `live` only after broker SUBACK. Slow-client backpressure bounded; client cap and payload cap.
- Browser consumes only sidecar SSE, never broker. Clears old route immediately; opt-in bound to route key, cleanup on unmount/opt-out/hidden tab; clock-independent local receipt ages derived from serverTime-receivedAt, not comparing server epoch against browser epoch.
- GPU GeoJSON bus circles and transparent touch hit area; tap card shared with accessible list, no hover-only information and no camera following. Keep markers independent of geometry bounds. No history retained.

## Implementation slices
1. Pure normalizer/store and deterministic fixtures (node:test): zero/nonfinite/range/snapped fallback, exact route joins, clock units/skew, duplicates/out-of-order, TTL/replacement.
2. Sidecar MQTT/SSE lifecycle + HTTP integration tests using injected fake transport, clock and synthetic vehicles. Cleanup, invalid route, shared subscriber, heartbeat/backpressure.
3. Browser hook + opt-in UI and map rendering. Selected Transjakarta route only, mobile card + accessible list, no GTFS/KRL changes.
4. Verify typecheck, all existing tests (baseline 77), new tests, browser DOM/MapLibre feature geometry at desktop/phone, and bounded actual sidecar stream. No screenshots (conversation limit). No next build alongside running next dev.

## Baseline / tooling
`npx tsc --noEmit` and 77 tests pass before changes. ESLint cannot start: installed typescript-eslint rejects TypeScript 7.0 (baseline toolchain incompatibility). Record that limitation; do not silently downgrade the project's compiler or change unrelated tooling.

## Prior art
- Existing map: `components/map/main-map.tsx`, `app/page.tsx`; mode-qualified routeKey prevents route ownership mistakes; fixed phone stop-card pattern already exists.
- Adopt MQTT.js (/mqttjs/mqtt.js, Context7 checked) for production protocol, not probe's handwritten packets. `reconnectPeriod: 0` permits manual bounded backoff; subscribe callback must check grants, not only connect event.
- Node HTTP SSE sidecar avoids lambda lifetime limits; installed Next self-hosting guide requires reverse proxy streaming without buffering.
- Community (not official permission or an oracle): https://git.rasyidanaf.com/0xrsydn/research/src/branch/main/transjakarta-live-data/analysis.md describes `/mobile_armada/<cell>/<route>/<trip>/<vehicle>`; independently validate joins/cadence/clocks.
