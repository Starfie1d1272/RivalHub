import { z } from "zod";

export const startDraftSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
});

export const pauseDraftSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
});

export const resumeDraftSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
});

export const pickPlayerSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
  entryId: z.guid("队伍 ID 格式不正确"),
  registrationId: z.guid("报名 ID 格式不正确"),
  clientRequestId: z.guid("请求 ID 格式不正确"),
});

export const skipDraftTurnSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
});

export type StartDraftInput = z.infer<typeof startDraftSchema>;
export type PauseDraftInput = z.infer<typeof pauseDraftSchema>;
export type ResumeDraftInput = z.infer<typeof resumeDraftSchema>;
export type PickPlayerInput = z.infer<typeof pickPlayerSchema>;
export type SkipDraftTurnInput = z.infer<typeof skipDraftTurnSchema>;
