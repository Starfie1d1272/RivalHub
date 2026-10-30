import { afterEach, expect, it, vi } from "vitest";
import { freshBroadcastStatus, readBilibiliRoom, readBilibiliStatus } from "@/lib/production/bilibili";

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

it("resolves a short link to a room and reuses the normal status lookup", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://live.bilibili.com/1898561135?tracking=secret" } }))
    .mockResolvedValueOnce(Response.json({ code: 0, data: { live_status: 1 } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliRoom("https://b23.tv/pBKYamw?secret=private")).toEqual({ roomId: "1898561135", status: "live" });
  expect(String(fetchMock.mock.calls[0][0])).toBe("https://b23.tv/pBKYamw");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual", credentials: "omit", cache: "no-store" });
  expect(String(fetchMock.mock.calls[1][0])).toContain("room_init?id=1898561135");
});

it("uses the same offline status for a direct room", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { live_status: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliRoom("https://live.bilibili.com/1881336099")).toEqual({ roomId: "1881336099", status: "offline" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["https://127.0.0.1/1", "http://b23.tv/next", "https://b23.tv.evil.test/next", "https://user:secret@b23.tv/next", "https://www.bilibili.com/video/BV1"])("does not follow unsafe or non-live redirects: %s", async location => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliRoom("https://b23.tv/short")).toEqual({ roomId: null, status: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("cancels redirect bodies without reading them", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 302, headers: { location: "https://127.0.0.1/" } })));
  expect(await readBilibiliRoom("https://b23.tv/body")).toEqual({ roomId: null, status: "unknown" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("limits redirect chains and degrades on invalid, timeout and non-redirect responses", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/next?secret=private" } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await readBilibiliRoom("https://b23.tv/short")).toEqual({ roomId: null, status: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(String(fetchMock.mock.calls[1][0])).toBe("https://b23.tv/next");
  fetchMock.mockReset().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(new Response("not a redirect"));
  expect(await readBilibiliRoom("https://b23.tv/timeout")).toEqual({ roomId: null, status: "unknown" });
  expect(await readBilibiliRoom("https://b23.tv/invalid")).toEqual({ roomId: null, status: "unknown" });
  expect(await readBilibiliRoom("https://evil.test/short")).toEqual({ roomId: null, status: "unknown" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
