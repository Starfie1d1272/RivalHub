import { describe, expect, it } from "vitest";
import { playerRowSchema, playerRowLenientSchema, ocrResponseSchema } from "@/lib/ocr/types";
import type { OCRProvider } from "@/lib/ocr/types";

describe("ocrResponseSchema (宽松)", () => {
  it("接受合法 OCR 结果", () => {
    const data = {
      players: [
        {
          perfectName: "测试选手",
          kills: 20,
          deaths: 10,
          assists: 5,
          hsPercent: 30,
          firstKills: 3,
          multiKills: 2,
          clutches: 1,
          adr: 85.5,
          rws: 12.34,
          ratingPro: 1.25,
          we: 10.5,
        },
      ],
    };
    const r = ocrResponseSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  it("接受含 null 值的数据", () => {
    const data = {
      players: [
        {
          perfectName: "选手A",
          kills: null,
          deaths: null,
          assists: null,
          hsPercent: null,
          firstKills: null,
          multiKills: null,
          clutches: null,
          adr: null,
          rws: null,
          ratingPro: null,
          we: null,
        },
      ],
    };
    const r = ocrResponseSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  it("拒绝空 players 数组", () => {
    const r = ocrResponseSchema.safeParse({ players: [] });
    expect(r.success).toBe(false);
  });

  it("顶层仅校验数组结构，不拒绝缺少 perfectName 的行（由行级过滤处理）", () => {
    const r = ocrResponseSchema.safeParse({
      players: [{ kills: 10 }],
    });
    // 顶层通过，缺少 perfectName 的行在 siliconflow.ts 行级过滤中丢弃
    expect(r.success).toBe(true);
  });

  it("超出传统范围的值仍然接受", () => {
    const r = ocrResponseSchema.safeParse({
      players: [{ perfectName: "x", hsPercent: 150, we: 20 }],
    });
    expect(r.success).toBe(true);
  });
});

describe("playerRowLenientSchema", () => {
  it("字符串数值自动转换", () => {
    const r = playerRowLenientSchema.safeParse({
      perfectName: "x", kills: "15", adr: "85.5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kills).toBe(15);
      expect(r.data.adr).toBe(85.5);
    }
  });

  it("不可转换的字符串置为 null", () => {
    const r = playerRowLenientSchema.safeParse({
      perfectName: "x", kills: "N/A",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kills).toBeNull();
    }
  });

  it("拒绝空 perfectName", () => {
    const r = playerRowLenientSchema.safeParse({ perfectName: "" });
    expect(r.success).toBe(false);
  });
});

describe("playerRowSchema (严格)", () => {
  it("we 范围 0-16", () => {
    expect(playerRowSchema.safeParse({ perfectName: "x", we: 0 }).success).toBe(true);
    expect(playerRowSchema.safeParse({ perfectName: "x", we: 16 }).success).toBe(true);
    expect(playerRowSchema.safeParse({ perfectName: "x", we: -1 }).success).toBe(false);
    expect(playerRowSchema.safeParse({ perfectName: "x", we: 16.1 }).success).toBe(false);
  });

  it("hsPercent 范围 0-100", () => {
    expect(playerRowSchema.safeParse({ perfectName: "x", hsPercent: 100 }).success).toBe(true);
    expect(playerRowSchema.safeParse({ perfectName: "x", hsPercent: 101 }).success).toBe(false);
    expect(playerRowSchema.safeParse({ perfectName: "x", hsPercent: -1 }).success).toBe(false);
  });

  it("kills 不可为负", () => {
    expect(playerRowSchema.safeParse({ perfectName: "x", kills: -1 }).success).toBe(false);
  });
});
