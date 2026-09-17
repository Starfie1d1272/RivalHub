import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_STEAM64 = "76561198000000001";
const PROFILE = {
  steam64: NEXT_STEAM64,
  personaName: "Official Steam Name",
  profileUrl: "https://steamcommunity.com/profiles/76561198000000001",
  avatarUrl: "https://avatars.steamstatic.com/profile.jpg",
};

const {
  requireAuthMock,
  updateMock,
  transactionMock,
  revalidatePathMock,
  findUserMock,
  assertAvailableMock,
  changePrimaryMock,
  getProfileMock,
  upsertProfileMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  updateMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  findUserMock: vi.fn(),
  assertAvailableMock: vi.fn(),
  changePrimaryMock: vi.fn(),
  getProfileMock: vi.fn(),
  upsertProfileMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/supabase-server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: {
    query: { users: { findFirst: findUserMock } },
    transaction: transactionMock,
  },
}));
vi.mock("@/lib/identity/gameplay-steam", () => ({
  assertSteam64Available: assertAvailableMock,
  changePrimarySteam64InTx: changePrimaryMock,
  findSteam64Conflict: vi.fn(),
}));
vi.mock("@/lib/steam-profiles", () => ({
  getSteamProfileForPrimary: getProfileMock,
  upsertSteamProfile: upsertProfileMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock, updateTag: vi.fn() }));

import { updateProfile } from "@/actions/account";

const validInput = {
  displayName: " Test User ",
  perfectName: " Perfect Nick ",
  steam64: NEXT_STEAM64,
  qq: "12345678",
  gameplayStyle: "",
  competitionHistory: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUserMock.mockResolvedValue({ steam64: null, status: "active" });
  assertAvailableMock.mockResolvedValue(undefined);
  getProfileMock.mockResolvedValue(PROFILE);
  requireAuthMock.mockResolvedValue({ userId: USER_ID, email: "user@local.test" });
  updateMock.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({ update: updateMock }));
});

describe("updateProfile Steam identity boundary", () => {
  it("requires provider-confirmed official data and persists it with the primary change", async () => {
    const result = await updateProfile(validInput);

    expect(result).toEqual({ success: true, data: undefined });
    expect(assertAvailableMock).toHaveBeenCalledWith(expect.anything(), NEXT_STEAM64, USER_ID);
    expect(getProfileMock).toHaveBeenCalledWith(expect.anything(), null, NEXT_STEAM64);
    expect(changePrimaryMock).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      nextSteam64: NEXT_STEAM64,
      actorId: USER_ID,
    });
    expect(upsertProfileMock).toHaveBeenCalledWith(expect.anything(), PROFILE);
    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      perfectName: "Perfect Nick",
      displayName: "Test User",
    }));
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });

  it("fails closed when the provider is unavailable", async () => {
    getProfileMock.mockRejectedValue(new AppError(ErrorCode.STEAM_PROVIDER_UNAVAILABLE, "暂时无法连接 Steam，请稍后重试。"));

    const result = await updateProfile(validInput);

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.STEAM_PROVIDER_UNAVAILABLE } });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns the non-disclosing conflict message before provider lookup", async () => {
    assertAvailableMock.mockRejectedValue(new AppError(ErrorCode.STEAM_PROFILE_CONFLICT, "该 Steam64 ID 已关联其他账户，请联系管理员处理。"));

    const result = await updateProfile(validInput);

    expect(result).toEqual({
      success: false,
      error: { code: ErrorCode.STEAM_PROFILE_CONFLICT, message: "该 Steam64 ID 已关联其他账户，请联系管理员处理。" },
    });
    expect(getProfileMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("allows removing the current Steam64 without leaving a legacy avatar field", async () => {
    const result = await updateProfile({ ...validInput, steam64: "" });

    expect(result).toMatchObject({ success: true });
    expect(changePrimaryMock).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      nextSteam64: null,
      actorId: USER_ID,
    });
    expect(getProfileMock).not.toHaveBeenCalled();
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it("trims the player-entered display and Perfect names", async () => {
    await updateProfile(validInput);

    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      perfectName: "Perfect Nick",
      displayName: "Test User",
    }));
  });

  it("turns blank optional identity fields into null", async () => {
    await updateProfile({ ...validInput, perfectName: "  ", liveStreamUrl: "  " });

    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      perfectName: null,
      liveStreamUrl: null,
    }));
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
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("stores normalized long-lived player-declared profile fields", async () => {
    await updateProfile({ ...validInput, gameplayStyle: "  稳健控图  ", competitionHistory: "  参加过校赛  " });

    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      gameplayStyle: "稳健控图",
      competitionHistory: "参加过校赛",
    }));
  });

  it("clears blank long-lived player-declared profile fields", async () => {
    await updateProfile({ ...validInput, gameplayStyle: "  ", competitionHistory: "  " });

    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      gameplayStyle: null,
      competitionHistory: null,
    }));
  });

  it("does not overwrite long-lived player-declared profile fields when omitted", async () => {
    await updateProfile({ ...validInput, gameplayStyle: undefined, competitionHistory: undefined });

    const payload = updateMock.mock.results[0]?.value.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(payload, "gameplayStyle")).toBe(false);
    expect(Object.hasOwn(payload, "competitionHistory")).toBe(false);
  });

  it("treats explicit null long-lived player-declared profile fields as clears", async () => {
    await updateProfile({ ...validInput, gameplayStyle: null, competitionHistory: null });

    expect(updateMock.mock.results[0]?.value.set).toHaveBeenCalledWith(expect.objectContaining({
      gameplayStyle: null,
      competitionHistory: null,
    }));
  });
});
