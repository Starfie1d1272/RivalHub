import { describe, expect, it } from "vitest";
import { presentMatchFormat, presentMatchStatus } from "@/lib/matches/presentation";

describe("match status presentation", () => {
  it("uses intentional broadcast vocabulary only where it is user-facing", () => {
    expect(presentMatchStatus("in_progress")).toEqual({ label: "LIVE", tone: "info" });
    expect(presentMatchStatus("finished")).toEqual({ label: "FT", tone: "success" });
    expect(presentMatchFormat("bo3")).toEqual({ label: "BO3", tone: "neutral" });
  });
});
