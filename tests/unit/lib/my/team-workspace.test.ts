import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

import { presentMyTeamHistory, type MembershipPeriod } from "@/lib/my/team-workspace";

describe("个人队伍成员历史", () => {
  it("队长交接后不从当前 captain 字段反推历史角色", () => {
    const row: MembershipPeriod = {
      membership: {
        id: "membership-1",
        userId: "former-captain",
        status: "left",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-06-01T00:00:00Z"),
      },
      team: {
        id: "team-1",
        slug: "rival-team",
        name: "Rival Team",
        logoUrl: null,
        description: null,
        captainUserId: "new-captain",
        status: "active",
      },
    };

    const history = presentMyTeamHistory(row);

    expect(history).toMatchObject({ teamId: "team-1", teamName: "Rival Team", status: "left", endedAt: "2026-06-01T00:00:00.000Z" });
    expect(history).not.toHaveProperty("role");
  });
});
