import {
  MAP_LABELS,
  MAP_PREFERENCE_LABELS,
  MAP_PREFERENCE_LEVELS,
  type MapPreference,
  type MapPreferenceLevel,
} from "@/types/season";

export const PLAYABLE_MAP_LEVELS = new Set<MapPreferenceLevel>([
  "playable",
  "proficient",
  "strong",
]);

export function mapLabel(map: string): string {
  return MAP_LABELS[map] ?? map.replace(/^de_/, "");
}

export function mapPreferenceLabel(level: MapPreferenceLevel): string {
  return MAP_PREFERENCE_LABELS[level];
}

export function mapPreferenceWeight(level: MapPreferenceLevel): number {
  const index = MAP_PREFERENCE_LEVELS.indexOf(level);
  return index === -1 ? 0 : index;
}

export function defaultMapPreferences(mapPool: readonly string[]): MapPreference[] {
  return mapPool.map((map) => ({ map, level: "basic" }));
}

export function normalizeMapPreferences(
  preferences: readonly MapPreference[] | null | undefined,
  mapPool: readonly string[],
): MapPreference[] {
  const byMap = new Map((preferences ?? []).map((pref) => [pref.map, pref.level]));
  return mapPool.map((map) => ({
    map,
    level: byMap.get(map) ?? "basic",
  }));
}
