import { describe, expect, it } from "vitest";
import { canRecruitForSeason, isRecruitmentTargetAvailable, isTeamRecruitmentTargetAvailable } from "@/lib/recruitment/target-policy";

const now = new Date("2026-09-02T00:00:00.000Z");

describe("recruitment target policy", () => {
  it("only admits active registration windows", () => {
    expect(isRecruitmentTargetAvailable({ status: "registration", registrationClosesAt: new Date("2026-09-03T00:00:00.000Z"), rosterChangeClosesAt: null }, now)).toBe(true);
    expect(isRecruitmentTargetAvailable({ status: "registration", registrationClosesAt: null, rosterChangeClosesAt: null }, now)).toBe(true);
    expect(isRecruitmentTargetAvailable({ status: "registration", registrationClosesAt: new Date("2026-09-01T00:00:00.000Z"), rosterChangeClosesAt: null }, now)).toBe(false);
    expect(isRecruitmentTargetAvailable({ status: "registration", registrationClosesAt: new Date("2026-09-01T00:00:00.000Z"), rosterChangeClosesAt: new Date("2026-09-03T00:00:00.000Z") }, now)).toBe(true);
  });

  it("keeps recruitment available before registration actually opens", () => {
    expect(canRecruitForSeason({ status: "registration", registrationClosesAt: new Date("2026-09-03T00:00:00.000Z"), rosterChangeClosesAt: null }, now)).toBe(true);
  });

  it("requires an effective Entry for Team recruitment after applications close", () => {
    const rosterOnly = { status: "registration" as const, registrationClosesAt: new Date("2026-09-01T00:00:00.000Z"), rosterChangeClosesAt: new Date("2026-09-03T00:00:00.000Z") };
    expect(isTeamRecruitmentTargetAvailable(rosterOnly, false, now)).toBe(false);
    expect(isTeamRecruitmentTargetAvailable(rosterOnly, true, now)).toBe(true);
  });

  it.each(["draft", "voting", "drafting", "playing", "finished", "archived"] as const)("does not expose %s Seasons to recruitment", (status) => {
    expect(isRecruitmentTargetAvailable({ status, registrationClosesAt: new Date("2026-09-03T00:00:00.000Z"), rosterChangeClosesAt: null }, now)).toBe(false);
  });
});
