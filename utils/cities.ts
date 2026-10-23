import type { TransitMode } from "@/lib/gtfs";

/** City is a view boundary, not a geographic bounding box. Routes crossing
 * city limits still belong to the city whose network operates them. */
export type City = "jakarta" | "bandung";
export const CITY_MODES = {
  jakarta: ["krl", "mrt", "lrt", "lrtj", "gtfs"],
  bandung: [
    "bdg-kci",
    "bdg-kai",
    "bdg-mjt",
    "bdg-tmb",
    "bdg-damri",
    "bdg-angkot",
  ],
} as const satisfies Record<City, readonly TransitMode[]>;
export const cityModes = (city: City): readonly TransitMode[] =>
  CITY_MODES[city];
export const cityForMode = (mode: TransitMode): City =>
  mode.startsWith("bdg-") ? "bandung" : "jakarta";
/** Bus datasets, for paint and label rules that differ from rail. */
export const BUS_MODES = [
  "gtfs",
  "bdg-mjt",
  "bdg-tmb",
  "bdg-damri",
  "bdg-angkot",
] as const;
export const isBusMode = (mode: TransitMode) =>
  (BUS_MODES as readonly TransitMode[]).includes(mode);
