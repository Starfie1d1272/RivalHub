import { z } from "zod";

// 尽力将任意值转为 number，无法转换则返回 null
const numOrNull = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
    return null;
  },
  z.number().nullable().default(null),
);

// 严格版（保留供参考）
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

// 宽松版：仅要求 perfectName 非空，数值字段尽力转换，不设上下限
export const playerRowLenientSchema = z.object({
  perfectName: z.string().min(1),
  kills: numOrNull,
  deaths: numOrNull,
  assists: numOrNull,
  hsPercent: numOrNull,
  firstKills: numOrNull,
  multiKills: numOrNull,
  clutches: numOrNull,
  adr: numOrNull,
  rws: numOrNull,
  ratingPro: numOrNull,
  we: numOrNull,
});

export const ocrResponseSchema = z.object({
  // 顶层仅校验 players 是数组（1-20 个元素），不做逐行字段校验
  // 逐行过滤在 siliconflow.ts 中用 playerRowLenientSchema 完成
  players: z.array(z.unknown()).min(1).max(20),
});

export type PlayerRowOCR = z.infer<typeof playerRowLenientSchema>;
export type ScoreboardOCRResult = { players: PlayerRowOCR[] };

export interface OCRProvider {
  name: string;
  extract(base64Image: string, mimeType: string): Promise<ScoreboardOCRResult>;
}
