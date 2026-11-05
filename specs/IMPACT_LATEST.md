# Live Transjakarta impact assessment

## Target
Add live vehicles through a standalone MQTT/SSE sidecar. User confirmed VPS hosting. Work isolated on feat/transjakarta-live.

### Updated request: Transjakarta landing + default live route badges
Landing view now gtfs. When feature flags are configured, bus display is on by default. No selection uses viewport-scoped SSE; a selected gtfs route uses exact route filtering. The user can opt out across route changes, and other operators suspend live. Changes touch live scope parsing/types, normalizer/store static style projection, hub/HTTP scope filtering, browser hook scope identity, map-idle bounds reporting, route-badge image registration/style reload, and page/control defaults. No baked GTFS or static API changes. New tests cover bbox validation, scoped fleet projection and trusted route names/colours. Verification uses DOM and MapLibre queryRenderedFeatures, not screenshots.

## Dependents
- app/page.tsx: owns mode-qualified selectedKey, station state, route detail, desktop/mobile cards. Only selected gtfs routes eligible; resetting or switching mode must close live stream immediately.
- components/map/main-map.tsx: MapLibre sources, interactiveLayerIds, click priority, layer reordering and theme reload. New stable GPU source must not join geometryBounds/fit dependencies; bus taps must not open unrelated stop popup.
- New components/live/: hook, control/cards, map layer with touch targets and accessible list.
- New utils/transjakarta-live.ts and live/: normalization, bounded state, subscriber, filtered SSE and tests.
- package.json/package-lock.json: MQTT.js runtime dependency and sidecar script. .env.example: disabled flags, sidecar address/origin. Deployment instructions only, not deployment.

## Affected stories
No release-plan.yaml or epic capsule exists in this checkout. Task plan: specs/PLAN_TRANSJAKARTA_LIVE.md. Research evidence: specs/archive/spikes/SPIKE-transjakarta-live.md (worker generating).

## Test coverage
Baseline: 77 utils tests plus tsc pass. Existing all-modes, nearby, trunk-lines and rail tests protect static behavior. No component runner: browser DOM/hit testing needed for touch targets, route switching and map theme reload.
New deterministic tests cover zero coordinates, malformed payloads, raw/snapped selection, source-clock skew/receipt freshness, route join, duplicate/out-of-order state, TTL, one-subscriber sharing and SSE cleanup/backpressure. External broker is not a unit-test dependency.

## Risk: Medium-high
Additive backend but shared map event ordering and stale-data semantics are user-facing correctness risks. Receive time proves recent delivery, not recent measurement. Clock correction is not a licence to make old telemetry fresh.

## Recommended action
Proceed in test-first vertical slices after probe results. Keep service/deployment flags explicit, avoid public deployment until realtime terms confirmed; once configured, user-facing bus display is enabled by default. Preserve all baked datasets and static caching byte-for-byte. Keep client/server SSE clock semantics explicit. Refuse broker SUBSCRIBE failures, bound memory and reconnects, stop upstream with no viewers. No commits or pushes without user request.
