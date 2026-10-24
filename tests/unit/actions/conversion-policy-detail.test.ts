import { AppError, ErrorCode } from "@/lib/errors";
import { expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: boundary.authorize, auditActorId: vi.fn() }));
vi.mock("@/lib/competitive/conversion-policy-admin", async original => ({ ...await original<object>(), loadConversionPolicyAdminDetail: boundary.read }));
import { readConversionPolicyDetail } from "@/actions/conversion-policies";
it("rechecks permission for each detail request and never reads after withdrawal or invalid input", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  boundary.authorize.mockResolvedValueOnce({ userId: "admin" }).mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "forbidden"));
  boundary.read.mockResolvedValueOnce({ id });
  expect((await readConversionPolicyDetail(id)).success).toBe(true);
  expect((await readConversionPolicyDetail(id)).success).toBe(false);
  expect(boundary.authorize).toHaveBeenCalledTimes(2);
  expect(boundary.read).toHaveBeenCalledTimes(1);
  expect((await readConversionPolicyDetail("invalid")).success).toBe(false);
  expect(boundary.read).toHaveBeenCalledTimes(1);
});
