# MRT Jakarta verification

## Scope
Operating MRT North–South line M, Lebak Bulus–Bundaran HI. Thirteen stations, both directions, no fabricated headway. Phase 2 under-construction stations are excluded.

## Checks
- `npm run sync:mrt`: fetched OSM relations 9677669 and 9677670 and baked the dataset.
- `tsx --test utils/*.test.ts`: 25 tests passed, including shared station midpoint placement and the existing KRL/trunk suite.
- `tsc --noEmit`: passed.
- `npm run build`: passed; `/api/mrt/routes`, `/api/mrt/overview`, `/api/mrt/stops/geo` included in static output.
- API smoke: route index has M only, route detail has 13 stops/two directions, GeoJSON has 13 points, overview has two shapes, Dukuh Atas search has one result.
- Firefox desktop: MRT picker enabled, full network framed with station dots/names, route selection and diagram correct, Dukuh Atas search opens popup, switching MRT→KRL→MRT clears the previous selection. No browser errors.
- Firefox z17: Blok M, Dukuh Atas and Bundaran HI overview markers are within 0.024px of the baked midpoint; selected-route Blok M marker matches too. No browser errors. Rebuilt after removing the temporary map hook.
- Station markers are matched by stable base name and centered between the two OSM direction calls. Interior track geometry is unchanged; both terminal shapes still meet the shared station point.
- Screenshots saved under `/tmp/transum-mrt-*.webp` and `/tmp/mrt-midpoint-*.webp`, not added to the repository.

## Lint limitation
Running ESLint on the new files failed before linting: the installed `typescript-eslint` dependency rejects TypeScript 7.0 (`typescript-eslint does not support TS 7.0`). No dependency changes made for this unrelated compatibility issue. Do not report lint as passing.

## Refreshing data
Run `npm run sync:mrt` explicitly and review `data/mrt/` changes. The build uses baked files; it does not fetch MRT data from OSM.
