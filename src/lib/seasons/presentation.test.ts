import { describe, expect, it } from "vitest";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

describe("season status presentation", () => {
  it("keeps normal UI labels out of internal enum vocabulary", () => {
    expect(presentSeasonStatus("registration")).toEqual({ label: "报名开放", tone: "success" });
    expect(presentSeasonStatus("playing")).toEqual({ label: "LIVE", tone: "danger" });
  });
});
