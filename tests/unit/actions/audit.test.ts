import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSuperAdminMock, dbSelectMock } = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  requireSeasonAdmin: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select: dbSelectMock },
}));

import { fetchAuditLogs } from "@/actions/audit";

describe("fetchAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdminMock.mockResolvedValue({ userId: "admin-1", role: "super_admin", seasonIds: [] });

    let selectCall = 0;
    dbSelectMock.mockImplementation(() => {
      const callIndex = selectCall++;
      let table: unknown;
      const builder = {
        from(nextTable: unknown) {
          table = nextTable;
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        offset() {
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const value = callIndex === 0
            ? [{
                id: "log-1",
                createdAt: new Date("2026-09-12T12:00:00.000Z"),
                action: "match.delete",
                actorId: "system",
                meta: null,
                seasonId: null,
                targetId: "deleted-match",
                targetType: "match",
              }]
            : callIndex === 1
              ? [{ count: 1 }]
              : [];
          void table;
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    });
  });

  it("preserves tombstone lifecycle while mapping a deleted target", async () => {
    const result = await fetchAuditLogs();

    expect(result).toMatchObject({ success: true, data: { total: 1 } });
    if (result.success) {
      expect(result.data.logs[0]).toMatchObject({
        actionLabel: "删除比赛",
        targetTypeLabel: "比赛",
        targetLabel: "已删除 / 历史目标 · deleted-",
      });
    }
  });
});
