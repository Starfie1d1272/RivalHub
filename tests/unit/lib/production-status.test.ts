import { afterEach, describe, expect, it, vi } from "vitest";
import { readBilibiliStatus } from "@/lib/production/bilibili";
import { readUploaderDownloads } from "@/lib/production/uploader";
afterEach(() => vi.unstubAllGlobals());
describe("best effort production adapters", () => {
 it("does not call a provider for absent or unrelated URLs", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await readBilibiliStatus(null)).toBe("unknown"); expect(await readBilibiliStatus("https://evil.test/123")).toBe("unknown"); expect(fetch).not.toHaveBeenCalled();
 });
 it.each([[1,"live"],[0,"offline"],[2,"offline"],[9,"unknown"]])("projects platform status %s", async (live_status, expected) => {
  const fetch = vi.fn().mockResolvedValue({ ok:true, json: async () => ({ code:0, data:{live_status} }) }); vi.stubGlobal("fetch",fetch);
  expect(await readBilibiliStatus("https://live.bilibili.com/123")).toBe(expected);
  expect(fetch.mock.calls[0][1].next.revalidate).toBe(60);
 });
 it("preserves unknown on failure and rejects untrusted download URLs", async () => {
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
  expect(await readBilibiliStatus("https://live.bilibili.com/123")).toBe("unknown");
  expect(await readUploaderDownloads()).toBeNull();
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({schemaVersion:"cs2-demo-analysis-kit/uploader-distribution-1",assets:{windows:{urls:["https://evil.test/app"]},macos:{urls:["https://evil.test/app"]}}})}));
  expect(await readUploaderDownloads()).toBeNull();
 });

});
