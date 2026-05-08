import { z } from "zod";

export const createMatchSchema = z.object({
  seasonId: z.string().uuid(),
  teamAId: z.string().uuid(),
  teamBId: z.string().uuid(),
  stage: z.enum(["qualifier", "playoff"]),
  format: z.enum(["bo1", "bo3", "bo5"]).default("bo1"),
  scheduledAt: z.string().datetime().optional(),
});

export const recordMatchResultSchema = z.object({
  matchId: z.string().uuid(),
  scoreA: z.number().int().min(0),
  scoreB: z.number().int().min(0),
  maps: z
    .array(
      z.object({
        mapOrder: z.number().int().min(1).max(5),
        mapName: z.string().min(1),
        pickedByTeamId: z.string().uuid().nullable(),
        teamAStartSide: z.enum(["t", "ct"]).nullable(),
        scoreA: z.number().int().min(0),
        scoreB: z.number().int().min(0),
      })
    )
    .optional(),
});

export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type RecordMatchResultInput = z.infer<typeof recordMatchResultSchema>;
