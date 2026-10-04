import { describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const { authorize, select } = vi.hoisted(() => ({ authorize: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: authorize }));
vi.mock("@/db/client", () => ({ db: { select } }));
import { loadAdminMatchCommentary } from "@/lib/admin/matches/commentary";

describe("commentary queue authorization", () => {
  it.each([ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN])("authorizes the requested season before any queue query: %s", async (code) => {
    authorize.mockRejectedValueOnce(new AppError(code, "无权查看本届赛事。"));
    await expect(loadAdminMatchCommentary("other-season")).rejects.toMatchObject({ code });
    expect(authorize).toHaveBeenCalledWith("other-season");
    expect(select).not.toHaveBeenCalled();
  });
});
