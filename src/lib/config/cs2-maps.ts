/** Stable CS2 map catalog. Valve rotation never removes historical entries. */
export const CS2_MAP_CATALOG = [
  { key: "de_mirage", label: "Mirage" },
  { key: "de_inferno", label: "Inferno" },
  { key: "de_nuke", label: "Nuke" },
  { key: "de_ancient", label: "Ancient" },
  { key: "de_dust2", label: "Dust2" },
  { key: "de_anubis", label: "Anubis" },
  { key: "de_train", label: "Train" },
  { key: "de_cache", label: "Cache" },
  { key: "de_overpass", label: "Overpass" },
  { key: "de_vertigo", label: "Vertigo" },
] as const;

export type Cs2MapKey = (typeof CS2_MAP_CATALOG)[number]["key"];

export const SUPPORTED_CS2_MAP_KEYS: readonly Cs2MapKey[] = CS2_MAP_CATALOG.map(
  ({ key }) => key,
) as Cs2MapKey[];

/** Current Valve/Premier reference pool; mutable rotation is isolated here. */
export const CURRENT_CS2_ACTIVE_DUTY_MAP_POOL = [
  "de_mirage",
  "de_inferno",
  "de_nuke",
  "de_ancient",
  "de_dust2",
  "de_anubis",
  "de_cache",
] as const satisfies readonly Cs2MapKey[];
