import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const { selectMock, requireSeasonAdminMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select: selectMock },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: vi.fn((session: { userId: string }) => session.userId),
}));

import { revokeSanction, searchSanctionSubjects } from "@/actions/discipline";

function chain<T>(value: T) {
  const calls: { limit?: number } = {};
  const result = {
    calls,
    from: () => result,
    where: () => result,
    orderBy: () => result,
    limit: (n: number) => {
      calls.limit = n;
      return result;
    },
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

describe("discipline actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1", role: "season_admin" });
  });

  describe("revokeSanction validation", () => {
    it("rejects an empty reason without touching the database", async () => {
      const result = await revokeSanction({ caseId: "11111111-1111-4111-8111-111111111111", reason: "   " });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
        expect(result.error.message).toContain("撤销原因");
      }
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("rejects a missing reason without touching the database", async () => {
      // Server Action 边界收到的是未类型化输入：模拟 reason 缺失的调用
      const result = await revokeSanction({ caseId: "11111111-1111-4111-8111-111111111111" } as Parameters<typeof revokeSanction>[0]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      }
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("searchSanctionSubjects", () => {
    it("rejects queries shorter than 2 characters without querying users", async () => {
      const result = await searchSanctionSubjects({
        seasonId: "11111111-1111-4111-8111-111111111111",
        query: "甲",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
        expect(result.error.message).toContain("至少 2 个字符");
      }
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("caps the result list at 10 users", async () => {
      const chainObj = chain([{ id: "user-1", displayName: "玩家甲", steamName: null, email: "a@example.test" }]);
      selectMock.mockReturnValue(chainObj);

      const result = await searchSanctionSubjects({
        seasonId: "11111111-1111-4111-8111-111111111111",
        query: "玩家",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ id: "user-1", label: "玩家甲", detail: "a@example.test" }]);
      }
      expect(requireSeasonAdminMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
      expect(chainObj.calls.limit).toBe(10);
    });

    it("propagates permission failures as action errors", async () => {
      requireSeasonAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "无权限"));
      const result = await searchSanctionSubjects({
        seasonId: "11111111-1111-4111-8111-111111111111",
        query: "玩家",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
      }
      expect(selectMock).not.toHaveBeenCalled();
    });
  });
});
