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

// Protect installer rollout compatibility and the existing trusted-download boundary.
describe("Uploader installer rollout", () => {
 const base = "https://dakupdate.starfie1d.top/releases/v1.2.3/";
 const windows = base + "uploader.zip", macos = base + "uploader.dmg";
 const installer = { name: "Uploader-Setup.exe", urls: [base + "Uploader-Setup.exe"], size: 123, sha256: "a".repeat(64) };
 function serve(windowsInstaller?: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
   schemaVersion: "cs2-demo-analysis-kit/uploader-distribution-1",
   assets: { windows: { urls: [windows] }, macos: { urls: [macos] }, windowsInstaller },
  }) }));
 }
 it("keeps old manifests and macOS downloads intact", async () => {
  serve(); expect(await readUploaderDownloads()).toEqual({ windows, macos });
 });
 it("prefers the published installer while retaining the full ZIP", async () => {
  serve(installer); expect(await readUploaderDownloads()).toEqual({ windows: installer.urls[0], windowsZip: windows, macos });
 });
 it.each([
  { ...installer, urls: ["https://evil.test/Setup.exe"] },
  { ...installer, urls: ["http://dakupdate.starfie1d.top/releases/Setup.exe"] },
  { ...installer, urls: ["https://user:password@dakupdate.starfie1d.top/releases/Setup.exe"] },
  { ...installer, urls: ["https://dakupdate.starfie1d.top/other/Setup.exe"] },
  { ...installer, size: 0 }, { ...installer, sha256: "invalid" }, { urls: installer.urls }, null,
 ])("falls back to ZIP for an invalid optional installer %#", async invalid => {
  serve(invalid); expect(await readUploaderDownloads()).toEqual({ windows, macos });
 });
});
