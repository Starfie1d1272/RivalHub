import { beforeEach, describe, expect, it, vi } from "vitest";
const { selectMock, updateMock, lookupMock, revalidateMock } = vi.hoisted(() => ({ selectMock: vi.fn(), updateMock: vi.fn(), lookupMock: vi.fn(), revalidateMock: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: selectMock, update: updateMock } }));
vi.mock("@/lib/steam", () => ({ getSteamPlayerSummaries: lookupMock }));
vi.mock("@/lib/revalidation", () => ({ revalidatePublicPlayerTag: revalidateMock }));
import { refreshSteamAvatars } from "@/lib/steam-avatars";

describe("avatar reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: () => ({ where: async () => [
      { id: "changed", steam64: "a", avatarUrl: "old" },
      { id: "same", steam64: "b", avatarUrl: "same" },
      { id: "missing", steam64: "c", avatarUrl: "keep" },
    ] }) });
    updateMock.mockReturnValue({ set: vi.fn().mockReturnValue({ where: () => ({ returning: async () => [{ id: "changed" }] }) }) });
  });
  it("updates and invalidates only changed images; a missing result preserves its cache", async () => {
    lookupMock.mockResolvedValue({ status: "ok", avatars: new Map([["a", "new"], ["b", "same"]]) });
    expect(await refreshSteamAvatars()).toEqual({ processed: 3, updated: 1, unresolved: 1 });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.results[0].value.set).toHaveBeenCalledWith({ avatarUrl: "new" });
    expect(revalidateMock).toHaveBeenCalledExactlyOnceWith("changed");
  });
  it.each(["unconfigured", "failed"])("rejects %s runs without modifying images", async (status) => {
    lookupMock.mockResolvedValue({ status });
    await expect(refreshSteamAvatars()).rejects.toThrow("STEAM_AVATAR_");
    expect(updateMock).not.toHaveBeenCalled(); expect(revalidateMock).not.toHaveBeenCalled();
  });
  it("does not invalidate a user whose identity changed during provider I/O", async () => {
    lookupMock.mockResolvedValue({ status: "ok", avatars: new Map([["a", "new"]]) });
    updateMock.mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [] }) }) });
    expect(await refreshSteamAvatars()).toMatchObject({ updated: 0 });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
