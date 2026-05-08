import { z } from "zod";

export const positionValues = ["entry", "awper", "support", "lurker", "igl"] as const;
export type Position = (typeof positionValues)[number];

export const POSITION_LABELS: Record<Position, { cn: string; en: string }> = {
  igl:     { cn: "指挥",   en: "IGL" },
  awper:   { cn: "狙击手", en: "AWPer" },
  entry:   { cn: "打手",   en: "Entry" },
  lurker:  { cn: "游走",   en: "Lurker" },
  support: { cn: "辅助",   en: "Support" },
};

// 空字符串 → undefined 的预处理辅助
const optionalStr = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const registrationSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),

  email: z
    .string()
    .min(1, "请填写电子邮件")
    .email("请输入有效的电子邮件地址"),

  steam64: optionalStr(
    z.string().regex(/^\d{17}$/, "Steam64 ID 应为 17 位纯数字")
  ),

  qq: optionalStr(
    z.string().regex(/^\d{5,12}$/, "请输入有效的 QQ 号（5-12 位数字）")
  ),

  primaryPosition: z.enum(positionValues, {
    errorMap: () => ({ message: "请选择主要位置" }),
  }),

  secondaryPosition: optionalStr(z.enum(positionValues)),

  // CS2 Premier 分 0-35000，留余量到 50000
  peakRating: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0, "评分不能为负").max(50000, "评分最大 50000").optional()
  ),

  screenshotUrl: optionalStr(
    z.string().url("请输入有效的链接（以 http:// 或 https:// 开头）")
  ),

  willingToBeCaptain: z.boolean().default(false),

  notes: optionalStr(
    z.string().max(500, "备注不超过 500 字")
  ),

  antiCheatPledge: z.literal(true, {
    errorMap: () => ({ message: "请勾选反作弊承诺方可提交" }),
  }),
});

export type RegistrationFormData = z.infer<typeof registrationSchema>;

// MAX_PER_POSITION：每个主选位置的报名上限（草稿约束，管理员可豁免）
// 8 队 × 7 人 = 56，5 个位置，各位置人数不均，预留 buffer 到 15
export const MAX_PER_POSITION = 15;
