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
vi.mock("@/db/schema", () => ({ auditLogs: {} }));
vi.mock("@/lib/scheduler/execution", () => ({
  executeScheduledJobManually: executeScheduledJobManuallyMock,
}));
vi.mock("@/lib/scheduler/runners", () => ({
  runSchedulerJobByKey: runSchedulerJobByKeyMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

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

  it("requires super-admin, writes low-sensitivity audit, and runs the shared runner directly", async () => {
    const result = await runSchedulerJobManually({ jobKey: "draft-timeout" });

    expect(result).toEqual({ success: true, data: { jobKey: "draft-timeout", businessTransitions: 2 } });
    expect(requireSuperAdminMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledOnce();
    const values = insertMock.mock.results[0]?.value.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values).toMatchObject({
      action: "scheduler.manual_trigger",
      actorId: "admin-1",
      targetId: "draft-timeout",
      targetType: "scheduler_job",
      meta: { jobKey: "draft-timeout", force: true, source: "super-admin-manual" },
    });
    expect(executeScheduledJobManuallyMock).toHaveBeenCalledWith("draft-timeout", expect.any(Function));
    expect(runSchedulerJobByKeyMock).toHaveBeenCalledWith("draft-timeout");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/settings");
  });
});
