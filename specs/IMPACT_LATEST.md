# LRT Jakarta impact and implementation plan

## Target
Add LRT as two transit modes, split by operator: LRT Jakarta (Jakarta government, via Jakpro) and LRT Jabodebek (PT KAI).

## Scope (confirmed with owner)
All three operating lines. The owner asked for the two systems to be split in the dropdown, since J belongs to the Jakarta government and CB/BK to PT KAI. Mode `lrt` (`data/lrt/`) holds J; mode `lrtj` (`data/lrtj/`) holds CB and BK.

| id | line | stations | OSM relations (out / back) | colour |
|----|------|----------|----------------------------|--------|
| J  | LRT Jakarta Lin Selatan, Manggarai - Kelapa Gading | 11 | 10693119 / 10693160 | F16227 |
| CB | Jabodebek Cibubur, Dukuh Atas - Harjamukti | 12 | 16036440 / 16036441 | 20409A |
| BK | Jabodebek Bekasi, Dukuh Atas - Jatimulya | 14 | 16079479 / 16079478 | 0E6938 |

LRT Jakarta Fase 1B (Velodrome - Manggarai) opened 16 Sep 2026, so the whole Jakpro line is operating. Cibubur and Bekasi share Dukuh Atas - Cawang (8 stations incl. Cawang), so 12 + 14 - 8 = 18 unique Jabodebek stations, matching KAI's published 18. Jakpro adds 11 stations.

## Dependents
- `lib/gtfs.ts`: TransitMode, TRANSIT_MODES, parseMode, per-mode accessors.
- `app/api/[mode]/**`: static params come from TRANSIT_MODES.
- `app/page.tsx`: mode picker, immediate station-layer load, `mode === "krl"` interchange/offset paths.
- `components/map/main-map.tsx`: attribution, rail floors, `mode !== "gtfs"` overview style, KRL-only interchange logic.
- New: `scripts/sync-lrt.ts`, `utils/lrt-data.ts`, `data/lrt/`, LRT tests.

## Risk: Medium
Shared station merging and a shared 8-station trunk are new relative to MRT (a single line). KRL interchange rendering is keyed on `mode === "krl"`, so LRT needs its own decision about how Cawang, Dukuh Atas and the Cibubur/Bekasi split render. Existing GTFS/KRL/MRT data must remain byte-identical.

## Findings from OSM inspection
- All six relations chain into continuous tracks, every stop within 0 m of the chained line and in order.
- The LRT Jakarta return relation starts with a 168 m spur way at Kelapa Gading that is not on the outbound relation; terminal trimming must cut it.
- Station names carry sponsor naming rights (`Dukuh Atas Bank Syariah Indonesia`); match on stable base names, not full names.
- `Setiabudi`, `Cawang`, `Dukuh Atas`, `Manggarai` are shared station names with MRT/KRL but are different physical stations; LRT data stays in its own mode.

## Sources
- https://www.openstreetmap.org/relation/10693119, 10693160, 16036440, 16036441, 16079478, 16079479
- https://lrtjabodebek.kai.id/informasi-peta-rute
- https://www.kompas.id/artikel/lrt-jakarta-resmi-beroperasi-hingga-manggarai-integrasi-antarmoda-disiapkan
