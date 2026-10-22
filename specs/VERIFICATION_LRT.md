# LRT verification

## Scope
Two separate modes, one per operator, each with its own dataset and its own entry in the mode picker. Both directions of every line are baked, with no invented timetable.

| Mode | Dropdown | Operator | Dataset | Lines | Stations |
|------|----------|----------|---------|-------|----------|
| `lrt`  | LRT Jakarta   | Jakarta government (Jakpro) | `data/lrt/`  | J Manggarai - Kelapa Gading | 11 |
| `lrtj` | LRT Jabodebek | PT KAI | `data/lrtj/` | CB Dukuh Atas - Harjamukti, BK Dukuh Atas - Jatimulya | 18 |

Cibubur and Bekasi share 8 trunk stations (Dukuh Atas - Cawang), so 12 + 14 - 8 = 18, which matches KAI's published count. The two systems share no station.

`npm run sync:lrt` bakes both systems. It fetches and validates both before writing either dataset, so a failure cannot leave them out of step.

## Checks
- `npm run sync:lrt`: baked `data/lrt` (1 line, 11 stations) and `data/lrtj` (2 lines, 18 stations).
- `tsx --test utils/*.test.ts`: 46 passed. This covers the system split, both bakers with fixtures, both real datasets, per-mode isolation, the line-offset rules, and the existing GTFS/KRL/MRT suites.
- `tsc --noEmit`: passed. `npm run build`: passed. `/api/lrt/*` and `/api/lrtj/*` (routes, overview, stops/geo) are both prerendered.
- `data/gtfs`, `data/krl` and `data/mrt` are unchanged. The MRT re-bake after the shared-helper refactor was byte-identical.
- Firefox, production build: the dropdown lists Transjakarta, KRL, MRT, LRT Jakarta and LRT Jabodebek. LRT Jakarta shows only J with 11 dots; LRT Jabodebek shows only CB and BK with 18 dots. At Kuningan the CB and BK lines render side by side (+3/-3 px). Switching Jabodebek back to Jakarta clears the other system. No browser errors.

## Notes
- The shared-trunk offset applies only in mode `lrtj` (`utils/line-offset.ts`). LRT Jakarta is a single line and is never offset. `bakeLrt` requires its `mode` argument with no default, because a default once silently baked the Jabodebek overview without offsets.
- A dev server keeps old baked JSON in its per-process memo after a re-sync. Restart it before judging a re-bake in the browser.
- Lint is still blocked: typescript-eslint rejects TypeScript 7.0.

## Sources
- OSM relations 10693119, 10693160 (J); 16036440, 16036441 (CB); 16079478, 16079479 (BK).
- https://lrtjabodebek.kai.id/informasi-peta-rute
- https://www.kompas.id/artikel/lrt-jakarta-resmi-beroperasi-hingga-manggarai-integrasi-antarmoda-disiapkan (Fase 1B opened 16 Sep 2026).
