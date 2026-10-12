import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSuperAdminMock,
  auditActorIdMock,
  insertMock,
  executeScheduledJobManuallyMock,
  runSchedulerJobByKeyMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  auditActorIdMock: vi.fn(),
  insertMock: vi.fn(),
  executeScheduledJobManuallyMock: vi.fn(),
  runSchedulerJobByKeyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: auditActorIdMock,
}));
vi.mock("@/db/client", () => ({ db: { insert: insertMock } }));
vi.mock("@/lib/scheduler/execution", () => ({
  executeScheduledJobManually: executeScheduledJobManuallyMock,
}));
vi.mock("@/lib/scheduler/runners", () => ({
  runSchedulerJobByKey: runSchedulerJobByKeyMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { AppError, ErrorCode } from "@/lib/errors";

import { runSchedulerJobManually } from "@/actions/scheduler";

describe("manual scheduler action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdminMock.mockResolvedValue({ userId: "admin-1", email: "admin@example.com", role: "super_admin", seasonIds: [] });
    auditActorIdMock.mockReturnValue("admin-1");
    insertMock.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    runSchedulerJobByKeyMock.mockResolvedValue({ result: {}, businessTransitions: 2 });
    executeScheduledJobManuallyMock.mockImplementation(async (jobKey: string, runner: () => Promise<unknown>) => {
      await runner();
      return { source: "super-admin-manual", skipped: false, businessTransitions: 2, jobKey };
    });
  });

  it("rejects unauthorized manual execution before audit, runner, or cache mutation", async () => {
    requireSuperAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    expect(await runSchedulerJobManually({ jobKey: "draft-timeout" })).toMatchObject({
      success: false,
      error: { code: ErrorCode.FORBIDDEN },
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(executeScheduledJobManuallyMock).not.toHaveBeenCalled();
    expect(runSchedulerJobByKeyMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // The manual recovery surface must give a correlated, actionable safe response.

});
