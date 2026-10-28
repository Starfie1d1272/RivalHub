import { expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), insert: vi.fn(), execute: vi.fn(), run: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: mocks.authorize, auditActorId: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { insert: mocks.insert } }));
vi.mock("@/lib/scheduler/execution", () => ({ executeScheduledJobManually: mocks.execute }));
vi.mock("@/lib/scheduler/runners", () => ({ runSchedulerJobByKey: mocks.run }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { runSchedulerJobManually } from "@/actions/scheduler";

it("rejects unauthorized manual execution before audit, runner, or cache mutation", async () => {
  mocks.authorize.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));
  expect(await runSchedulerJobManually({ jobKey: "draft-timeout" })).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
