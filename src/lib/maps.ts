import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import type { MapPreference, MapPreferenceDraft, MapPreferenceLevel } from "@/types/season";

export const MAP_PREFERENCE_LEVELS: readonly MapPreferenceLevel[] = [
  "none",
  "basic",
  "playable",
  "proficient",
  "strong",
] as const;

export const MAP_PREFERENCE_LABELS: Record<MapPreferenceLevel, string> = {
  none: "不会",
  basic: "认路",
  playable: "能打",
  proficient: "熟练",
  strong: "强图",
};

export const PLAYABLE_MAP_LEVELS = new Set<MapPreferenceLevel>([
  "playable",
  "proficient",
  "strong",
]);

export function mapLabel(map: string): string {
  return CS2_MAP_CATALOG.find((entry) => entry.key === map)?.label ?? map.replace(/^de_/, "");
}

export function mapPreferenceLabel(level: MapPreferenceLevel): string {
  return MAP_PREFERENCE_LABELS[level];
}

export function mapPreferenceWeight(level: MapPreferenceLevel): number {
  const index = MAP_PREFERENCE_LEVELS.indexOf(level);
  return index === -1 ? 0 : index;
}

export function defaultMapPreferences(mapPool: readonly string[]): MapPreferenceDraft[] {
  return projectMapPreferences([], mapPool);
}

/**
 * Project sparse user facts into a context-specific map pool. Missing maps are
 * deliberately nullable so the UI can show "未填写" without manufacturing a
 * persisted `basic` or `none` fact.
 */
export function projectMapPreferences(
  preferences: readonly MapPreferenceDraft[] | null | undefined,
  mapPool: readonly string[],
): MapPreferenceDraft[] {
  const byMap = new Map<string, MapPreferenceLevel>();
  for (const preference of preferences ?? []) {
    if (preference.level !== null) byMap.set(preference.map, preference.level);
  }
  return mapPool.map((map) => ({
    map,
    level: byMap.get(map) ?? null,
  }));
}

/** Convert editable/projection state to the sparse facts accepted by storage. */
export function toMapPreferenceFacts(
  preferences: readonly MapPreferenceDraft[] | null | undefined,
): MapPreference[] {
  return (preferences ?? []).filter(
    (preference): preference is MapPreference => preference.level !== null,
  );
}
