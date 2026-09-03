import { z } from "zod";
import { MAP_PREFERENCE_LEVELS, type MapPreferenceLevel } from "@/types/season";
import { PLAYABLE_MAP_LEVELS } from "@/lib/maps";

/**
 * Canonical map-preference validation owner. Both the season registration form
 * and the long-term competitive profile reuse the same level semantics and set
 * rules (no duplicates, ≥3 playable, ≤3 strong).
 */
export function mapPreferencesSchema(mapPool: readonly string[]) {
  return z
    .array(
      z.object({
        map: z.string().refine((value) => mapPool.includes(value), { message: "地图不在图池中" }),
        level: z.enum(MAP_PREFERENCE_LEVELS as [MapPreferenceLevel, ...MapPreferenceLevel[]]),
      }),
    )
    .length(mapPool.length, "请为图池中的每张地图选择熟练度")
    .superRefine((preferences, ctx) => {
      const seen = new Set<string>();
      let playableCount = 0;
      let strongCount = 0;
      for (const preference of preferences) {
        if (seen.has(preference.map)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "地图偏好不能重复" });
          return;
        }
        seen.add(preference.map);
        if (PLAYABLE_MAP_LEVELS.has(preference.level)) playableCount++;
        if (preference.level === "strong") strongCount++;
      }
      if (playableCount < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请至少选择 3 张达到「能打」及以上的地图" });
      }
      if (strongCount > 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "「强图」最多选择 3 张" });
      }
    });
}
