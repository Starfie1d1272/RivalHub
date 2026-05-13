import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const {
  requireAuthMock,
  transactionMock,
  teamFindFirstMock,
  registrationFindFirstMock,
  seasonFindFirstMock,
  updateMock,
  insertMock,
  updateSetCalls,
  insertValuesCalls,
  revalidatePathMock,
} = vi.hoisted(() => {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  return {
    requireAuthMock: vi.fn(),
    transactionMock: vi.fn(),
    teamFindFirstMock: vi.fn(),
    registrationFindFirstMock: vi.fn(),
    seasonFindFirstMock: vi.fn(),
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    updateSetCalls,
    insertValuesCalls,
    revalidatePathMock: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  auditActorId: vi.fn((session) => session.userId),
  requireAuth: requireAuthMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/db/client", () => {
  const tx = {
    query: {
      teams: { findFirst: teamFindFirstMock },
      seasonRegistrations: { findFirst: registrationFindFirstMock },
      seasons: { findFirst: seasonFindFirstMock },
    },
    update: updateMock,
    insert: insertMock,
  };

  return {
    db: {
      transaction: transactionMock.mockImplementation((callback) => callback(tx)),
    },
  };
});

import { updateTeamName } from "@/actions/teams";

describe("updateTeamName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    insertValuesCalls.length = 0;

    requireAuthMock.mockResolvedValue({
      userId: "user-1",
      email: "captain@example.com",
      role: "user",
      adminSeasonIds: [],
      authSource: "user",
    });
    updateMock.mockImplementation(() => ({
      set: vi.fn((values) => {
        updateSetCalls.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    insertMock.mockImplementation(() => ({
      values: vi.fn((values) => {
        insertValuesCalls.push(values);
        return Promise.resolve();
      }),
    }));
  });

  it("allows the team captain to rename their team and writes audit log", async () => {
    teamFindFirstMock.mockResolvedValue({
      id: "team-1",
      seasonId: "season-1",
      name: "Old Name",
      captainRegistrationId: "reg-1",
    });
    registrationFindFirstMock.mockResolvedValue({ id: "reg-1" });
    seasonFindFirstMock.mockResolvedValue({ slug: "spring" });

    const result = await updateTeamName("team-1", "  New Name  ");

    expect(result).toEqual({ success: true, data: undefined });
    expect(updateSetCalls).toContainEqual({
      name: "New Name",
    });
    expect(insertValuesCalls).toContainEqual({
      seasonId: "season-1",
      action: "team.rename",
      actorId: "user-1",
      targetId: "team-1",
      targetType: "team",
      meta: { from: "Old Name", to: "New Name" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/spring/teams");
    expect(revalidatePathMock).toHaveBeenCalledWith("/spring/teams/team-1");
  });

  it("rejects users who are not the team captain", async () => {
    teamFindFirstMock.mockResolvedValue({
      id: "team-1",
      seasonId: "season-1",
      name: "Old Name",
      captainRegistrationId: "reg-1",
    });
    registrationFindFirstMock.mockResolvedValue({ id: "reg-other" });

    const result = await updateTeamName("team-1", "New Name");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    }
    expect(updateSetCalls).toEqual([]);
    expect(insertValuesCalls).toEqual([]);
  });
});
