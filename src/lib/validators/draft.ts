import { z } from "zod";

export const startDraftSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),
});

export const pauseDraftSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),
});

export const resumeDraftSchema = z.object({
  seasonId: z.string().uuid("赛季 ID 格式不正确"),
});

export type StartDraftInput = z.infer<typeof startDraftSchema>;
export type PauseDraftInput = z.infer<typeof pauseDraftSchema>;
export type ResumeDraftInput = z.infer<typeof resumeDraftSchema>;
