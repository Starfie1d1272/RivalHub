import { z } from "zod";

// TODO: 实现完整 Zod 校验 schema（中文错误消息）
// 校验维度：email / steam64 / QQ / 主次位置 / peakRating / screenshotUrl / 反作弊承诺

export const positionValues = ["entry", "awper", "support", "lurker", "igl"] as const;
export type Position = (typeof positionValues)[number];

export const registrationSchema = z.object({
  seasonId: z.string().uuid(),
  email: z.string().email(),
  steam64: z.string().optional(),
  qq: z.string().optional(),
  primaryPosition: z.enum(positionValues),
  secondaryPosition: z.enum(positionValues).optional(),
  peakRating: z.number().int().optional(),
  screenshotUrl: z.string().url().optional(),
  willingToBeCaptain: z.boolean().default(false),
  notes: z.string().optional(),
});

export type RegistrationFormData = z.infer<typeof registrationSchema>;
