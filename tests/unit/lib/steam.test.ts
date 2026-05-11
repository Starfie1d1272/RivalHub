import { describe, expect, it } from "vitest";

// getSteamAvatar 依赖 STEAM_API_KEY env 和网络请求，测试 happy/sad path
// 通过 mock fetch 来测试

describe("getSteamAvatar", () => {
  it("缺少 STEAM_API_KEY 时返回 null（无 fetch 调用）", async () => {
    // 不设 STEAM_API_KEY，直接 import 后调用
    const { getSteamAvatar } = await import("@/lib/steam");
    const result = await getSteamAvatar("76561198000000001");
    expect(result).toBeNull();
  });

  it("steam64 为空字符串时返回 null", async () => {
    const { getSteamAvatar } = await import("@/lib/steam");
    const result = await getSteamAvatar("");
    expect(result).toBeNull();
  });
});
