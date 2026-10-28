import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: mocks.authorize, auditActorId: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { updateCompetitivePlatform } from "@/actions/competitive-platform";

it("rejects non-super-admin operators before touching the database", async () => {
  mocks.authorize.mockRejectedValue(new Error("权限不足"));
  const result = await updateCompetitivePlatform({ key: "perfect_world", displayName: "新名称", ratingLabel: "Rating Pro" });
  expect(result.success).toBe(false);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
