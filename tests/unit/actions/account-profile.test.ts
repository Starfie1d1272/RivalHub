import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const { requireAuthMock, updateMock, revalidatePathMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  updateMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/supabase-server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { update: updateMock } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateProfile } from "@/actions/account";

const validInput = {
  displayName: " Test User ",
  steamName: " Steam Name ",
  perfectName: " Perfect Nick ",
  steam64: "76561198000000001",
  steamProfileUrl: "https://steamcommunity.com/id/test",
  qq: "12345678",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ userId: USER_ID, email: "user@local.test" });
  updateMock.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
});

describe("updateProfile Perfect identity boundary", () => {
  it("trims and stores the one canonical Perfect nickname", async () => {
    const result = await updateProfile(validInput);

    expect(result).toEqual({ success: true, data: undefined });
    const set = updateMock.mock.results[0]?.value.set;
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      perfectName: "Perfect Nick",
      displayName: "Test User",
    }));
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });

  it("turns blank optional identity fields into null", async () => {
    await updateProfile({ ...validInput, perfectName: "  ", liveStreamUrl: "  " });

    const set = updateMock.mock.results[0]?.value.set;
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ perfectName: null, liveStreamUrl: null }));
  });

  it("stores only valid http(s) live-stream URLs", async () => {
    await updateProfile({ ...validInput, liveStreamUrl: " https://live.example/room " });
    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({ liveStreamUrl: "https://live.example/room" }));
    vi.clearAllMocks();
    const result = await updateProfile({ ...validInput, liveStreamUrl: "javascript:alert(1)" });
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
  });

  it("rejects malformed identity fields before authentication", async () => {
    const result = await updateProfile({ ...validInput, steam64: "123", qq: "not-qq" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

});
