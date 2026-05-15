import { z } from "zod";
import { REGISTRATION_DEFAULTS } from "@/lib/config/registration-defaults";
import {
  PLAYER_TYPE_LABELS,
  MAP_PREFERENCE_LEVELS,
  normalizeRegistrationConfig,
  RIVALS_REGISTRATION_CONFIG,
  type MapPreferenceLevel,
  type PlayerType,
  type RegistrationConfig,
} from "@/types/season";
import { PLAYABLE_MAP_LEVELS } from "@/lib/maps";
import type { PositionValue, RankValue } from "@/lib/config/registration-defaults";

// ── 从配置派生位置常量 ──────────────────────────────
export const positionValues = REGISTRATION_DEFAULTS.positions.values;
export type Position = PositionValue;

export const POSITION_LABELS = REGISTRATION_DEFAULTS.positions.labels;

export function positionLabel(position: string): string {
  return POSITION_LABELS[position as keyof typeof POSITION_LABELS]?.en ?? position;
}

/** 位置单字母缩写 */
export const POS_ABBR: Record<string, string> = {
  opener: "O",
  closer: "C",
  anchor: "A",
  igl: "I",
  awper: "W",
};

// ── 从配置派生段位常量 ──────────────────────────────
export const rankValues = REGISTRATION_DEFAULTS.ranks.values;
export type Rank = RankValue;

export const RANK_LABELS = REGISTRATION_DEFAULTS.ranks.labels;
export { PLAYER_TYPE_LABELS };

export const RANK_ORDER = REGISTRATION_DEFAULTS.ranks.values;

export const registrationSeedSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),
});

function isAllowedRank(value: string): value is RankValue {
  return (RANK_ORDER as readonly string[]).includes(value);
}

function rankMeetsThreshold(rank: string, min: string | null): boolean {
  if (min === null) return true;
  const rankIndex = RANK_ORDER.indexOf(rank as RankValue);
  const minIndex = RANK_ORDER.indexOf(min as RankValue);
  return rankIndex >= 0 && minIndex >= 0 && rankIndex >= minIndex;
}

function rankThresholdMessage(config: RegistrationConfig): string {
  const current = config.rankThreshold.currentMin;
  const peak = config.rankThreshold.peakMin;
  if (current && peak) {
    return `报名资格：当前赛季最高段位需达到 ${current}，或历史最高段位需达到 ${peak}`;
  }
  if (current) return `报名资格：当前赛季最高段位需达到 ${current}`;
  if (peak) return `报名资格：历史最高段位需达到 ${peak}`;
  return "段位未达到报名资格";
}

function nonEmptyAllowed<T extends string>(values: readonly T[], fallback: readonly T[]): readonly T[] {
  return values.length > 0 ? values : fallback;
}

// ── 验证 schema factory ─────────────────────────────
export function buildRegistrationSchema(
  inputConfig: Partial<RegistrationConfig> | null | undefined,
  inputPositions: readonly string[],
) {
  const config = normalizeRegistrationConfig(inputConfig);
  const positions = nonEmptyAllowed(inputPositions, positionValues);
  const allowedPlayerTypes = nonEmptyAllowed<PlayerType>(
    config.allowedPlayerTypes,
    RIVALS_REGISTRATION_CONFIG.allowedPlayerTypes,
  );
  const mapPool = config.mapPool.length ? config.mapPool : RIVALS_REGISTRATION_CONFIG.mapPool;

  return z
    .object({
      seasonId: z.string().uuid("赛季 ID 格式不正确"),

      // ── 基础信息 ──
      email: z
        .string()
        .min(1, "请填写电子邮件")
        .email("请输入有效的电子邮件地址"),

      studentId: z
        .string()
        .min(1, "请填写学号（毕业生填「毕业年份+学院」）"),

      playerType: z
        .string()
        .refine((v): v is PlayerType => (allowedPlayerTypes as readonly string[]).includes(v), {
          message: "请选择允许的身份类型",
        }),

      qq: z
        .string()
        .min(1, "请填写 QQ 号")
        .regex(/^\d{5,12}$/, "请输入有效的 QQ 号（5-12 位数字）"),

      perfectName: z
        .string()
        .min(1, "请填写完美平台昵称"),

      steamName: z
        .string()
        .min(1, "请填写 Steam 昵称"),

      steam64: z
        .string()
        .min(1, "请填写 Steam 64 位 ID")
        .regex(/^\d{17}$/, "Steam64 ID 应为 17 位纯数字"),

      steamProfileUrl: z
        .string()
        .min(1, "请填写 Steam 个人资料链接")
        .url("请输入有效的链接")
        .refine(
          (v) => v.includes("steamcommunity.com"),
          "链接必须为 steamcommunity.com 域名",
        ),

      // ── 位置 ──
      primaryPosition: z.string().refine((v) => positions.includes(v), {
        message: "请选择主选位置",
      }),

      secondaryPosition: z.string().refine((v) => positions.includes(v), {
        message: "请选择次选位置",
      }),

      // ── 段位 · 历史最高 ──
      peakRank: z.string().refine(isAllowedRank, {
        message: "请选择历史最高段位",
      }),

      peakRankSeason: z
        .string()
        .min(1, "请填写取得最高段位的赛季（如 S1 2026）"),

      // Rating：完美平台 Rating，0.01–3.00，两位小数
      peakRating: z
        .number({ invalid_type_error: "请输入数字" })
        .min(0.01, "Rating 最小 0.01")
        .max(3.00, "Rating 最大 3.00")
        .refine(
          (v) => Math.round(v * 100) / 100 === v,
          "Rating 最多保留两位小数",
        ),

      // WE：Win Effect，0.0–16.0，一位小数
      peakWe: z
        .number({ invalid_type_error: "请输入数字" })
        .min(0, "WE 不能为负")
        .max(16.0, "WE 最大 16.0")
        .refine(
          (v) => Math.round(v * 10) / 10 === v,
          "WE 最多保留一位小数",
        )
        .optional(),

      // ── 段位 · 当前赛季最高 ──
      currentSeasonPeakRank: z.string().refine(isAllowedRank, {
        message: "请选择当前赛季最高段位",
      }),

      currentRating: z
        .number({ invalid_type_error: "请输入数字" })
        .min(0.01, "Rating 最小 0.01")
        .max(3.00, "Rating 最大 3.00")
        .refine(
          (v) => Math.round(v * 100) / 100 === v,
          "Rating 最多保留两位小数",
        ),

      currentWe: z
        .number({ invalid_type_error: "请输入数字" })
        .min(0, "WE 不能为负")
        .max(16.0, "WE 最大 16.0")
        .refine(
          (v) => Math.round(v * 10) / 10 === v,
          "WE 最多保留一位小数",
        )
        .optional(),

      // ── 天梯截图（NJUBox 分享链接）──
      screenshotUrls: z
        .array(
          z
            .string()
            .trim()
            .refine((v) => !v || /^https?:\/\/.+/.test(v), {
              message: "请输入有效的链接（以 http:// 或 https:// 开头）",
            }),
        )
        .max(config.screenshotCount, `最多填写 ${config.screenshotCount} 个截图链接`)
        .transform((urls) => urls.map((url) => url.trim()).filter(Boolean)),

      mapPreferences: z
        .array(
          z.object({
            map: z.string().refine((v) => mapPool.includes(v), {
              message: "地图不在当前赛季图池中",
            }),
            level: z.enum(MAP_PREFERENCE_LEVELS as [MapPreferenceLevel, ...MapPreferenceLevel[]]),
          }),
        )
        .length(mapPool.length, "请为当前图池中的每张地图选择熟练度"),

      // ── 风格与经历 ──
      gameplayStyle: z
        .string()
        .min(1, "请填写游戏风格自述")
        .max(100, "游戏风格自述不超过 100 字"),

      competitionHistory: z
        .string()
        .max(500, "历史比赛经历不超过 500 字")
        .optional(),

      highlightVideoUrl: z
        .string()
        .optional()
        .refine((v) => !v || /^https?:\/\/.+/.test(v), {
          message: "请输入有效的链接（以 http:// 或 https:// 开头）",
        }),

      // ── 其他 ──
      willingToBeCaptain: z.boolean().default(false),

      notes: z.string().max(500, "备注不超过 500 字").optional(),

      antiCheatPledge: z.literal(true, {
        errorMap: () => ({ message: "请勾选反作弊承诺方可提交" }),
      }),
    })
    .refine((data) => data.secondaryPosition !== data.primaryPosition, {
      message: "次选位置不能与主选位置相同",
      path: ["secondaryPosition"],
    })
    .superRefine((data, ctx) => {
      const seen = new Set<string>();
      let playableCount = 0;
      let strongCount = 0;
      for (const preference of data.mapPreferences) {
        if (seen.has(preference.map)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "地图偏好不能重复",
            path: ["mapPreferences"],
          });
          break;
        }
        seen.add(preference.map);
        if (PLAYABLE_MAP_LEVELS.has(preference.level)) playableCount++;
        if (preference.level === "strong") strongCount++;
      }
      if (playableCount < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "请至少选择 3 张达到「能打」及以上的地图",
          path: ["mapPreferences"],
        });
      }
      if (strongCount > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "「强图」最多选择 3 张",
          path: ["mapPreferences"],
        });
      }
    })
    .refine(
      (data) => {
        const hasCurrent = rankMeetsThreshold(data.currentSeasonPeakRank, config.rankThreshold.currentMin);
        const hasPeak = rankMeetsThreshold(data.peakRank, config.rankThreshold.peakMin);
        return hasCurrent || hasPeak;
      },
      {
        message: rankThresholdMessage(config),
        path: ["currentSeasonPeakRank"],
      },
    );
}

export const registrationSchema = buildRegistrationSchema(
  RIVALS_REGISTRATION_CONFIG,
  positionValues,
);

// ── 导出类型 ─────────────────────────────────────────
export type RegistrationFormData = z.infer<typeof registrationSchema>;
export type RegistrationInput = z.input<typeof registrationSchema>;
