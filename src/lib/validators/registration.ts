import { z } from "zod";
import { REGISTRATION_DEFAULTS } from "@/lib/config/registration-defaults";
import type { PositionValue, RankValue } from "@/lib/config/registration-defaults";

// ── 从配置派生位置常量 ──────────────────────────────
export const positionValues = REGISTRATION_DEFAULTS.positions.values;
export type Position = PositionValue;

export const POSITION_LABELS = REGISTRATION_DEFAULTS.positions.labels;

// ── 从配置派生段位常量 ──────────────────────────────
export const rankValues = REGISTRATION_DEFAULTS.ranks.values;
export type Rank = RankValue;

export const RANK_LABELS = REGISTRATION_DEFAULTS.ranks.labels;

// ── 每位置报名上限 ──────────────────────────────────
export const MAX_PER_POSITION = REGISTRATION_DEFAULTS.maxPerPosition;

// ── 验证 schema ──────────────────────────────────────
export const registrationSchema = z
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

    qq: z
      .string()
      .min(1, "请填写 QQ 号")
      .regex(/^\d{5,12}$/, "请输入有效的 QQ 号（5-12 位数字）"),

    perfectId: z
      .string()
      .min(1, "请填写完美平台 ID"),

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
    primaryPosition: z.enum(positionValues, {
      errorMap: () => ({ message: "请选择主选位置" }),
    }),

    secondaryPosition: z.enum(positionValues, {
      errorMap: () => ({ message: "请选择次选位置" }),
    }),

    // ── 段位 · 历史最高 ──
    peakRank: z.enum(rankValues, {
      errorMap: () => ({ message: "请选择历史最高段位" }),
    }),

    peakRankSeason: z
      .string()
      .min(1, "请填写取得最高段位的赛季（如 S1 2026）"),

    peakRating: z
      .number({ invalid_type_error: "请输入数字" })
      .int("请输入整数")
      .min(0, "Rating 不能为负")
      .max(50000, "Rating 最大 50000"),

    peakWe: z
      .number({ invalid_type_error: "请输入数字" })
      .int("请输入整数")
      .min(0, "WE 不能为负")
      .max(50000, "WE 最大 50000")
      .optional(),

    // ── 段位 · 当前赛季最高 ──
    currentSeasonPeakRank: z.enum(rankValues, {
      errorMap: () => ({ message: "请选择当前赛季最高段位" }),
    }),

    currentRating: z
      .number({ invalid_type_error: "请输入数字" })
      .int("请输入整数")
      .min(0, "Rating 不能为负")
      .max(50000, "Rating 最大 50000"),

    currentWe: z
      .number({ invalid_type_error: "请输入数字" })
      .int("请输入整数")
      .min(0, "WE 不能为负")
      .max(50000, "WE 最大 50000")
      .optional(),

    // ── 天梯截图（NJUBox 分享链接）──
    screenshotUrl: z
      .string()
      .min(1, "请填写 NJUBox 分享链接")
      .refine((v) => /^https?:\/\/.+/.test(v), {
        message: "请输入有效的链接（以 http:// 或 https:// 开头）",
      }),

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
  });

// ── 导出类型 ─────────────────────────────────────────
export type RegistrationFormData = z.infer<typeof registrationSchema>;
// React Hook Form 的输入类型（与 RegistrationFormData 大部分一致，
// 但 willingToBeCaptain 初始可能是 undefined）
export type RegistrationInput = z.input<typeof registrationSchema>;
