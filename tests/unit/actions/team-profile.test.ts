import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { findFirst, select, update, insert } = vi.hoisted(() => ({
  findFirst: vi.fn(), select: vi.fn(), update: vi.fn(), insert: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  auditActorId: vi.fn((session) => session.userId),
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: {
    query: { teams: { findFirst } }, select,
    transaction: async (body: (tx: unknown) => unknown) => body({ select, update, insert }),
  },
}));

import { updateTeamName } from "@/actions/teams";

const team = {
  id: "11111111-1111-4111-8111-111111111111", name: "Old Name", slug: "old-name",
  description: null, recruiting: false, captainUserId: "user-1", status: "active",
};

describe("updateTeamName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(team);
    select.mockReturnValue({ from: vi.fn(() => ({ where: vi.fn(() => ({ for: vi.fn(async () => [team]) })) })) });
    update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) });
    insert.mockReturnValue({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })) });
  });

  it("allows the current captain to rename a long-lived team", async () => {
    await expect(updateTeamName(team.id, "  New Name  ")).resolves.toEqual({ success: true, data: undefined });
  });

  it("rejects a user who is not the current captain", async () => {
    const otherCaptain = { ...team, captainUserId: "other-user" };
    findFirst.mockResolvedValue(otherCaptain);
    select.mockReturnValue({ from: vi.fn(() => ({ where: vi.fn(() => ({ for: vi.fn(async () => [otherCaptain]) })) })) });
    const result = await updateTeamName(team.id, "New Name");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
  });
});
