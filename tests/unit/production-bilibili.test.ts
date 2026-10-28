import { afterEach, expect, it, vi } from "vitest";
import { readBilibiliStatus } from "@/lib/production/bilibili";

afterEach(() => vi.unstubAllGlobals());
it("returns unknown on failed or malformed fresh reads", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliStatus("https://live.bilibili.com/1", { fresh: true })).toBe("unknown");
  expect(await readBilibiliStatus("https://live.bilibili.com/1", { fresh: true })).toBe("unknown");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});
