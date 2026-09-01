import { describe, expect, it } from "vitest";
import { presentSeasonParticipationState, presentSeasonStatus, presentStageMarker } from "@/lib/seasons/presentation";

describe("season status presentation", () => {
  it("keeps normal UI labels out of internal enum vocabulary", () => {
    expect(presentSeasonStatus("registration")).toEqual({ label: "已发布", tone: "success" });
    expect(presentSeasonStatus("playing")).toEqual({ label: "LIVE", tone: "danger" });
  });

  it("derives public participation labels from the canonical registration window", () => {
    expect(presentSeasonParticipationState({ status: "registration", registrationOpensAt: null, registrationOpenedAt: null, registrationClosesAt: null })).toMatchObject({ label: "报名时间待定" });
    expect(presentSeasonParticipationState({ status: "registration", registrationOpensAt: new Date("2999-01-01"), registrationOpenedAt: null, registrationClosesAt: null })).toMatchObject({ label: "即将开放" });
  });
});

describe("stage marker presentation", () => {
  it("uses the intentional Major marker instead of rendering a stage key directly", () => {
    expect(presentStageMarker({ key: "stage1", name: "阶段一" }, "major")).toBe("STAGE1");
    expect(presentStageMarker({ key: "custom-final", name: "决赛" }, "custom")).toBe("决赛");
  });
});
