import { describe, expect, it } from "vitest";
import { buildHomeEyebrow, buildHomeNavEntries } from "@/lib/home/navigation";
import { getSeasonLifecycleGroup, presentRegistrationSchedule } from "@/lib/seasons/presentation";

const season = {
  slug: "fried-chicken-cup", status: "registration" as const,
  registrationMode: "team" as const, hasCaptainVoting: false, hasDraft: false,
  registrationOpensAt: "2026-10-01T00:00:00Z",
  registrationOpenedAt: "2026-10-01T00:00:00Z",
  registrationClosesAt: "2026-10-07T12:00:00Z",
};

describe("homepage registration window", () => {
  it("stops advertising registration at the deadline without advancing the event lifecycle", () => {
    const before = new Date("2026-10-07T11:59:59.999Z");
    const deadline = new Date(season.registrationClosesAt);
    expect(buildHomeEyebrow(season, before).text).toBe("● 报名中");
    expect(buildHomeNavEntries(season, undefined, before).some(entry => entry.key === "register")).toBe(true);
    for (const now of [deadline, new Date("2026-10-08T00:00:00Z")]) {
      expect(buildHomeEyebrow(season, now).text).toBe("● 报名已截止");
      expect(presentRegistrationSchedule(season, now)?.primary).toContain("截止");
      expect(buildHomeNavEntries(season, undefined, now).some(entry => entry.key === "register")).toBe(false);
      expect(getSeasonLifecycleGroup(season)).toBe("active");
    }
  });

  it("does not advertise a scheduled window until the actual opening is recorded", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const pending = { ...season, registrationOpenedAt: null };
    expect(buildHomeEyebrow(pending, now).text).toBe("● 即将开放");
    expect(buildHomeNavEntries(pending, undefined, now).some(entry => entry.key === "register")).toBe(false);
    expect(buildHomeEyebrow({ ...pending, registrationOpensAt: null }, now).text).toBe("● 报名时间待定");
    expect(buildHomeEyebrow({ ...season, registrationClosesAt: null }, now).text).toBe("● 报名中");
    expect(buildHomeEyebrow({ ...season, status: "playing" }, now).text).toBe("● 比赛进行中");
  });
});
