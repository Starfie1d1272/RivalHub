import { describe, expect, it } from "vitest";
import { getCSTDateKey } from "@/lib/utils/date";
import {
  buildPlatformOperationsGrowth,
  summarizePlayerPool,
  summarizeTeamSizes,
} from "@/lib/admin/platform-operations/types";

describe("platform operations projections", () => {
  it("deduplicates current memberships and keeps empty active teams in the size summary", () => {
    const summary = summarizeTeamSizes([
      { teamId: "team-a", userId: "user-1" },
      { teamId: "team-a", userId: "user-1" },
      { teamId: "team-a", userId: "user-2" },
      { teamId: "team-b", userId: null },
      { teamId: "team-c", userId: "user-3" },
    ]);

    expect(summary).toMatchObject({ activeTeamCount: 3, totalMemberCount: 3, medianTeamSize: 1 });
    expect(summary.sizeDistribution).toEqual(expect.arrayContaining([
      { key: "0", label: "0 人", count: 1 },
      { key: "1", label: "1 人", count: 1 },
      { key: "2", label: "2 人", count: 1 },
      { key: "10-plus", label: "10+ 人", count: 0 },
    ]));
  });

  it("separates current team, certification, and public recruitment populations", () => {
    expect(summarizePlayerPool({
      currentMemberships: [
        { teamId: "team-a", userId: "user-1" },
        { teamId: "team-a", userId: "user-1" },
        { teamId: "team-a", userId: "user-2" },
      ],
      certifiedUserIds: ["user-1", "user-3", "user-3"],
      publicPlayerLft: 4,
      publicTeamRecruiting: 2,
    })).toEqual({
      currentTeamUsers: 2,
      certifiedWithoutTeam: 1,
      teamWithoutCertification: 1,
      publicPlayerLft: 4,
      publicTeamRecruiting: 2,
    });
  });

  it("buckets the rolling seven-day growth window by Asia/Shanghai calendar days", () => {
    const now = new Date("2026-09-15T04:00:00.000Z");
    const growth = buildPlatformOperationsGrowth(now, [
      { kind: "user_created", entityId: "outside", occurredAt: "2026-09-08T15:59:59.999Z" },
      { kind: "user_created", entityId: "boundary", occurredAt: "2026-09-08T16:00:00.000Z" },
      { kind: "education_approval", entityId: "user-1", occurredAt: "2026-09-10T16:00:00.000Z" },
      { kind: "education_approval", entityId: "user-1", occurredAt: "2026-09-10T17:00:00.000Z" },
      { kind: "education_approval", entityId: "user-2", occurredAt: "2026-09-10T17:00:00.000Z" },
      { kind: "team_created", entityId: "team-1", occurredAt: "2026-09-14T15:59:59.999Z" },
      { kind: "membership_started", entityId: "membership-1", occurredAt: "2026-09-14T16:00:00.000Z" },
    ]);

    expect(growth.map((day) => day.date)).toEqual([
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
    ]);
    expect(growth.find((day) => day.date === "2026-09-09")).toMatchObject({ newUsers: 1 });
    expect(growth.find((day) => day.date === "2026-09-11")).toMatchObject({ newEducationApprovals: 2 });
    expect(growth.find((day) => day.date === "2026-09-14")).toMatchObject({ newTeams: 1 });
    expect(growth.find((day) => day.date === "2026-09-15")).toMatchObject({ newMemberships: 1 });
    expect(getCSTDateKey("2026-09-14T15:59:59.999Z")).toBe("2026-09-14");
    expect(getCSTDateKey("2026-09-14T16:00:00.000Z")).toBe("2026-09-15");
  });
});
