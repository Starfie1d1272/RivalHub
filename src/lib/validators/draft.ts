import { z } from "zod";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";

const draftSeasonSchema = z.object({
  seasonId: z.guid("赛季 ID 格式不正确"),
});

export const startDraftSchema = draftSeasonSchema;
export const pauseDraftSchema = draftSeasonSchema;
export const resumeDraftSchema = draftSeasonSchema;

const draftTurnSchema = z.object({
  entryId: z.guid("队伍 ID 格式不正确"),
  round: z.number().int().min(1).max(DRAFT_TOTAL_ROUNDS),
  deadline: z.iso.datetime(),
});

const draftCommandSchema = draftSeasonSchema.extend({ expectedTurn: draftTurnSchema });

export const pickPlayerSchema = draftCommandSchema.extend({
  registrationId: z.guid("报名 ID 格式不正确"),
  clientRequestId: z.guid("请求 ID 格式不正确"),
});

export const skipDraftTurnSchema = draftCommandSchema;

export type DraftTurnInput = z.infer<typeof draftTurnSchema>;
export type StartDraftInput = z.infer<typeof startDraftSchema>;
export type PauseDraftInput = z.infer<typeof pauseDraftSchema>;
export type ResumeDraftInput = z.infer<typeof resumeDraftSchema>;
export type PickPlayerInput = z.infer<typeof pickPlayerSchema>;
export type SkipDraftTurnInput = z.infer<typeof skipDraftTurnSchema>;
