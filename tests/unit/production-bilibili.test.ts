import { afterEach, expect, it, vi } from "vitest";
import { freshBroadcastStatus, readBilibiliStatus } from "@/lib/production/bilibili";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());
it("returns unknown on failed or malformed reads", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliStatus("https://live.bilibili.com/1")).toBe("unknown");
  expect(await readBilibiliStatus("https://live.bilibili.com/1")).toBe("unknown");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});

 it("does not use expired or future-dated cached statuses as confirmation", () => {
  const result = { status: "live" as const, checkedAt: 1000 };
  expect(freshBroadcastStatus(result, 60999)).toBe("live");
  expect(freshBroadcastStatus(result, 61000)).toBe("unknown");
  expect(freshBroadcastStatus(result, 999)).toBe("unknown");
});
