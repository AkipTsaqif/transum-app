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

/** Every city, derived from `CITY_MODES` so a new entry is the only change. */
export const CITIES = Object.keys(CITY_MODES) as City[];

export const isCity = (value: string | null | undefined): value is City =>
  typeof value === "string" && (CITIES as string[]).includes(value);

/**
 * Which city owns a dataset, read from `CITY_MODES`.
 *
 * This used to be `mode.startsWith("bdg-")`, which silently filed any future
 * city's datasets under Jakarta -- they would load, but with Jakarta's modes,
 * walking connections and map credit.
 */
const MODE_CITY = new Map<TransitMode, City>(
  CITIES.flatMap((city) => CITY_MODES[city].map((mode) => [mode, city] as const)),
);
export const cityForMode = (mode: TransitMode): City => {
  const city = MODE_CITY.get(mode);
  if (!city) throw new Error(`Mode ${mode} is not registered in CITY_MODES`);
  return city;
};
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
