import { describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
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
    const e = matchCorrectionBlockedError([
      { code: "downstreamMatchStarted", params: { count: 1 } },
      { code: "downstreamStageMaterialized", params: { stageKey: "internal-playoff-stage" } },
    ]);

    expect(e.message).toContain("downstream_match_started");
    expect(e.message).toContain("已经开始或完成");
    expect(e.message).toContain("internal-playoff-stage");
    expect(e.presentation?.message).toContain("已经开始或完成");
    expect(e.presentation?.message).toContain("暂时不能自动应用");
    expect(e.presentation?.message).not.toContain("internal-playoff-stage");
    expect(e.presentation?.message).not.toContain("downstream_stage_materialized");
  });

});
