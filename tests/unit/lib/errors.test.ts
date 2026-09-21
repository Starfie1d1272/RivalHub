import { describe, expect, it } from "vitest";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { matchCorrectionBlockedError } from "@/lib/match-corrections/errors";

describe("AppError", () => {
  it("构造并访问属性", () => {
    const e = new AppError(ErrorCode.POSITION_FULL, "AWP 位置已满员");
    expect(e.code).toBe("POSITION_FULL");
    expect(e.message).toBe("AWP 位置已满员");
    expect(e.name).toBe("AppError");
    expect(e instanceof Error).toBe(true);
  });

  it("支持 meta 元数据", () => {
    const e = new AppError(ErrorCode.NOT_FOUND, "目标不存在", {
      entityId: "abc-123",
    });
    expect(e.meta).toEqual({ entityId: "abc-123" });
  });

  it("将结构化产品提示与内部诊断分离", () => {
    const e = AppError.withPresentation(
      ErrorCode.VALIDATION_FAILED,
      {
        owner: "major",
        key: "playoffNotReady",
        params: { stageKey: "playoff" },
        message: "当前阶段暂时还不能开始。",
      },
      { diagnostic: "StageRun playoff is missing required completed matches" },
    );

    expect(e.message).toContain("StageRun");
    expect(e.presentation).toEqual({
      owner: "major",
      key: "playoffNotReady",
      params: { stageKey: "playoff" },
      message: "当前阶段暂时还不能开始。",
    });
  });

  it("保留更正阻断原因供诊断，同时使用独立的产品提示", () => {
    const e = matchCorrectionBlockedError(["下游比赛已经开始或完成，不能自动改写。"]);

    expect(e.message).toContain("已经开始或完成");
    expect(e.presentation?.message).toContain("暂时不能自动应用");
  });

  it("每个 ErrorCode 都有对应的 ERROR_MESSAGES", () => {
    const codes = Object.values(ErrorCode);
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe("string");
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it("ERROR_MESSAGES key 数量与 ErrorCode 一致", () => {
    const codeCount = Object.values(ErrorCode).length;
    const msgCount = Object.keys(ERROR_MESSAGES).length;
    expect(msgCount).toBe(codeCount);
  });
});

describe("ErrorCode", () => {
  it("所有错误码唯一", () => {
    const values = Object.values(ErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("错误码命名遵循 UPPER_SNAKE_CASE", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(code).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });
});
