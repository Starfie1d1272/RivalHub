import { describe, expect, it } from "vitest";
import {
  assertBeforeTimeConfirmationCutoff,
  assertProposedTimeFitsDeadline,
} from "@/lib/matches/time-rules";

describe("validateTimeProposal", () => {
  it("accepts valid time within window", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const completionDeadline = new Date("2026-01-05T10:00:00Z");
    const proposedTime = new Date("2026-01-03T10:00:00Z");

    expect(() => assertBeforeTimeConfirmationCutoff(completionDeadline, now)).not.toThrow();
    expect(() => assertProposedTimeFitsDeadline(proposedTime, completionDeadline, now)).not.toThrow();
  });

  it("rejects time earlier than minimum allowed", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    expect(() => assertProposedTimeFitsDeadline(new Date("2026-01-01T09:59:00Z"), null, now)).toThrow("比赛时间必须晚于当前时间");
  });

  it("rejects time later than stage deadline", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const completionDeadline = new Date("2026-01-05T10:00:00Z");
    expect(() => assertProposedTimeFitsDeadline(new Date("2026-01-05T10:01:00Z"), completionDeadline, now)).toThrow("比赛时间不能晚于最晚完成时间");
  });
});
