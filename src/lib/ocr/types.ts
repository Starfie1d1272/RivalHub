import { z } from "zod";

export const playerRowSchema = z.object({
  perfectName: z.string(),
  kills: z.number().int().nonnegative().nullable().default(null),
  deaths: z.number().int().nonnegative().nullable().default(null),
  assists: z.number().int().nonnegative().nullable().default(null),
  hsPercent: z.number().int().min(0).max(100).nullable().default(null),
  firstKills: z.number().int().nonnegative().nullable().default(null),
  multiKills: z.number().int().nonnegative().nullable().default(null),
  clutches: z.number().int().nonnegative().nullable().default(null),
  adr: z.number().nonnegative().nullable().default(null),
  rws: z.number().nonnegative().nullable().default(null),
  ratingPro: z.number().nonnegative().nullable().default(null),
  we: z.number().min(0).max(16).nullable().default(null),
});

export const ocrResponseSchema = z.object({
  players: z.array(playerRowSchema).min(1).max(20),
});

export type PlayerRowOCR = z.infer<typeof playerRowSchema>;
export type ScoreboardOCRResult = z.infer<typeof ocrResponseSchema>;

export interface OCRProvider {
  name: string;
  extract(base64Image: string, mimeType: string): Promise<ScoreboardOCRResult>;
}
