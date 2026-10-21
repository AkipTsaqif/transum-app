# MRT Jakarta impact and implementation plan

## Target
Add MRT as a separate transit dataset and enable the existing MRT mode choice.

## Dependents
- `lib/gtfs.ts`: TransitMode, mode parser and per-mode file/cache accessors.
- `app/api/[mode]/**`: static parameter enumeration uses TRANSIT_MODES; all routes must support MRT without falling back to GTFS.
- `app/page.tsx`: mode picker, immediate small-network station load and mode-switch reset/framing.
- `components/map/main-map.tsx`: mode union, OSM attribution, overview/marker/label visibility.
- New `scripts/sync-mrt.ts`, `utils/mrt-data.ts`, `data/mrt/` and MRT tests.

## Affected stories
No release-plan or epic capsules currently exist in this repository.

## Test coverage
Existing 19 KRL/interchange/trunk tests are regression checks. Add tests for MRT's 13 ordered stations in both directions, geometry continuity and terminal trimming, missing/inactive data rejection, mode isolation, search and station resolution. Browser-check switching modes, route selection and station popup.

## Risk: Medium
Mode enumeration touches all seven API routes, but the shared file layout avoids API redesign. MRT must not trigger airport-specific display code or modify existing GTFS/KRL baked data.

## Implementation sequence
1. Test and bake operating OSM subway relations 9677669/9677670 only. Use M and station codes NS01–NS13; preserve current station names from OSM. No invented timetable.
2. Enable mrt in the shared mode union, APIs and picker. Treat non-GTFS modes as small rail networks for initial station visibility, opaque overview and framing; keep KRL-specific interchange/offset checks unchanged.
3. Run all tests, typecheck and production build; check APIs and Firefox interactions. Leave work uncommitted unless requested.

## Sources
- https://www.openstreetmap.org/relation/9677669
- https://www.openstreetmap.org/relation/9677670
- https://www.jakartamrt.co.id/
- https://bisnis.jakartamrt.co.id/naming-right
- https://landingpage-dev.jakartamrt.co.id/id/proyek/fase-2
