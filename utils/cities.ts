import type { TransitMode } from "@/lib/gtfs";

/** City is a view boundary, not a geographic bounding box. Routes crossing
 * city limits still belong to the city whose network operates them. */
export type City = "jakarta" | "bandung" | "surabaya";
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
  surabaya: ["sby-kai", "sby-suroboyo", "sby-transjatim"],
} as const satisfies Record<City, readonly TransitMode[]>;
export const cityModes = (city: City): readonly TransitMode[] =>
  CITY_MODES[city];

/** Display names, so no component has to hardcode "Jakarta"/"Bandung". */
export const CITY_LABELS: Record<City, string> = {
  jakarta: "Jakarta",
  bandung: "Bandung",
  surabaya: "Surabaya",
};

/** The "every mode in this city" view, e.g. `bandung-all`. */
export type CityView = `${City}-all`;
export const cityView = (city: City): CityView => `${city}-all`;
export const isCityView = (value: string): value is CityView =>
  CITIES.some((city) => cityView(city) === value);
export const cityForView = (view: CityView): City =>
  CITIES.find((city) => cityView(city) === view)!;

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
  "sby-suroboyo",
  "sby-transjatim",
] as const;
export const isBusMode = (mode: TransitMode) =>
  (BUS_MODES as readonly TransitMode[]).includes(mode);

/**
 * Rail networks that span a region rather than a city.
 *
 * Every rail mode shows its stations from z9, which is where a city-sized
 * network settles after the auto-fit. KAI Commuter Area VIII reaches Blitar
 * and Cepu, so its full-network fit lands at z8.97 -- floored to 8 -- and it
 * never cleared that gate: no station dots, no names, no route pins.
 *
 * The value is the lowest zoom at which this mode's stations draw. It sits
 * well under the measured fit (8.97 on desktop) so a narrow phone viewport,
 * which fits the same 147 km into fewer pixels and lands lower, still clears
 * it. Only modes listed here change; every other mode keeps z9 (rail) or its
 * bus gates.
 */
export const REGIONAL_RAIL_ZOOM: Partial<Record<TransitMode, number>> = {
  "sby-kai": 6,
};
