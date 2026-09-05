import { describe, expect, it } from "vitest";
import { presentCompetitiveRankSummary } from "./presentation";

describe("presentCompetitiveRankSummary", () => {
  it("shows exact stars only for star ranks", () => {
    expect(presentCompetitiveRankSummary("黄金S", 17, true)).toBe("黄金S · 17 星");
    expect(presentCompetitiveRankSummary("A+", 17, false)).toBe("A+");
  });

  it("does not invent a star count when the star fact is absent", () => {
    expect(presentCompetitiveRankSummary("钻石S", null, true)).toBe("钻石S · 星数缺失");
  });
});
