import { z } from "zod";
import {
  MAP_PREFERENCE_LEVELS,
  SUPPORTED_CS2_MAP_KEYS,
  type MapPreference,
  type MapPreferenceLevel,
} from "@/types/season";
import { PLAYABLE_MAP_LEVELS } from "@/lib/maps";

const mapPreferenceLevelSchema = z.enum(
  MAP_PREFERENCE_LEVELS as [MapPreferenceLevel, ...MapPreferenceLevel[]],
);

const persistedMapPreferenceEntrySchema = z.object({
  map: z.string().min(1, "地图不能为空"),
  level: mapPreferenceLevelSchema,
});

const eventMapPreferenceEntrySchema = z.object({
  map: z.string().min(1, "地图不能为空"),
  // Event forms need a draft state for an unfilled map. The surrounding schema
  // rejects null before data reaches the action output.
  level: mapPreferenceLevelSchema.nullable(),
});

function rejectDuplicateMaps(
  preferences: readonly { map: string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const preference of preferences) {
    if (seen.has(preference.map)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "地图偏好不能重复" });
    }
    seen.add(preference.map);
  }
}

/** Long-term user facts: sparse, catalog-bound, and free of event quotas. */
export function longTermMapPreferencesSchema() {
  const knownMaps = new Set<string>(SUPPORTED_CS2_MAP_KEYS);
  return z.array(persistedMapPreferenceEntrySchema)
    .max(SUPPORTED_CS2_MAP_KEYS.length, "长期地图资料超过稳定地图目录范围")
    .superRefine((preferences, ctx) => {
      rejectDuplicateMaps(preferences, ctx);
      for (const preference of preferences) {
        if (!knownMaps.has(preference.map)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "长期地图资料只能使用稳定地图目录中的地图" });
        }
      }
    });
}

/** Solo/event registration facts: complete event pool plus legacy quotas. */
export function eventMapPreferencesSchema(mapPool: readonly string[]) {
  return z.array(eventMapPreferenceEntrySchema)
    .length(mapPool.length, "请为图池中的每张地图选择熟练度")
    .superRefine((preferences, ctx) => {
      rejectDuplicateMaps(preferences, ctx);
      let playableCount = 0;
      let strongCount = 0;
      for (const preference of preferences) {
        if (!mapPool.includes(preference.map)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "地图不在图池中" });
        }
        if (preference.level === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请为每张地图选择熟练度" });
          continue;
        }
        if (PLAYABLE_MAP_LEVELS.has(preference.level)) playableCount++;
        if (preference.level === "strong") strongCount++;
      }
      if (playableCount < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请至少选择 3 张达到「能打」及以上的地图" });
      }
      if (strongCount > 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "「强图」最多选择 3 张" });
      }
    })
    .transform((preferences) => preferences as MapPreference[]);
}
