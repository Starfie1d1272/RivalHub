import { describe, expect, it } from "vitest";
import { presentSeasonStatus, presentStageMarker } from "@/lib/seasons/presentation";

describe("season status presentation", () => {
  it("keeps normal UI labels out of internal enum vocabulary", () => {
    expect(presentSeasonStatus("registration")).toEqual({ label: "报名开放", tone: "success" });
    expect(presentSeasonStatus("playing")).toEqual({ label: "LIVE", tone: "danger" });
  });
});

describe("stage marker presentation", () => {
  it("uses the intentional Major marker instead of rendering a stage key directly", () => {
    expect(presentStageMarker({ key: "stage1", name: "阶段一" }, "major")).toBe("STAGE1");
    expect(presentStageMarker({ key: "custom-final", name: "决赛" }, "custom")).toBe("决赛");
  });
});
