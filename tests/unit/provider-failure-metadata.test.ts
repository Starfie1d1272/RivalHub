import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { providerFailureMetadata } from "@/lib/observability/provider-failure";
import { sanitizeSafeContext } from "@/lib/observability/redact";
const mocks = vi.hoisted(() => ({ log: vi.fn(), capture: vi.fn(), upload: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/observability/server", () => ({ logEvent: mocks.log, captureException: mocks.capture }));
vi.mock("@/lib/auth/supabase-server", () => ({ createServiceClient: () => ({ storage: {
  from: () => ({ upload: mocks.upload }),
} }) }));
import { getSteamPlayerSummaries } from "@/lib/steam";
import { educationEvidenceStorage } from "@/lib/education/storage";
import { seasonPublicAssetsStorage } from "@/lib/season-public-info/storage";

describe("provider diagnostics preserve safe causes without reading sensitive payloads", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
  afterEach(() => vi.unstubAllGlobals());
  it("projects bounded SDK status and nested network causes, surviving cycles and hostile getters", () => {
    const secret = vi.fn(() => { throw new Error("secret payload accessed"); });
    const cause = { code: "ECONNRESET" } as { code: string; cause?: unknown };
    cause.cause = cause;
    const error = Object.defineProperties({ name: "StorageUnknownError", originalError: cause, statusCode: "503" }, {
      message: { get: secret }, stack: { get: secret }, body: { get: secret },
    });
    const result = providerFailureMetadata(error);
    expect(sanitizeSafeContext(result)).toEqual({ errorName: "StorageUnknownError", errorCodes: ["ECONNRESET"], httpStatus: 503 });
    expect(secret).not.toHaveBeenCalled();
    expect(providerFailureMetadata(Object.defineProperty({}, "code", { get: secret })).errorCodes).toEqual([]);
  });
  it("does not accept arbitrary identifiers, fake statuses or unbounded cause chains", () => {
    const result = providerFailureMetadata({ name: "private-file.pdf", code: "secret123", status: 999, message: "secret" });
    expect(JSON.stringify(result)).not.toMatch(/secret|private|999/);
    let chain: object = { code: "ECONNREFUSED" };
    for (let i = 0; i < 9; i++) chain = { cause: chain };
    expect(providerFailureMetadata(chain).errorCodes).toEqual([]);
  });
  it("retains Steam network failure cause while keeping its existing failed result and suppressing its credential URL", async () => {
    vi.stubEnv("STEAM_API_KEY", "private-test-key");
    try {
      mocks.fetch.mockRejectedValue(new TypeError("https://steam.invalid/?key=private-test-key", { cause: { code: "ENOTFOUND" } }));
      expect(await getSteamPlayerSummaries(["76561198000000001"])).toEqual({ status: "failed" });
      expect(mocks.capture).toHaveBeenCalledWith("provider.steam.failure", expect.any(Error), expect.objectContaining({ safeContext: expect.objectContaining({ errorCodes: ["ENOTFOUND"] }) }));
      expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("private-test-key");
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([401, 429, 503])("both Storage adapters keep rejection and emit safe HTTP %i metadata", async (status) => {
    mocks.upload.mockResolvedValue({ error: { name: "StorageApiError", status, code: "AccessDenied", message: "private/object.png secret" } });
    const file = new File(["test"], "private.png", { type: "image/png" });
    await expect(educationEvidenceStorage.upload("private/key", file, "image/png")).rejects.toThrow();
    await expect(seasonPublicAssetsStorage.upload("private/key", file, "image/png")).rejects.toThrow();
    expect(mocks.log).toHaveBeenCalledTimes(2);
    for (const [event] of mocks.log.mock.calls) {
      expect(event.retryable).toBe(status !== 401);
      expect(sanitizeSafeContext(event.safeContext)).toEqual({ provider: "supabase", errorName: "StorageApiError", errorCodes: ["AccessDenied"], httpStatus: status });
      expect(JSON.stringify(event)).not.toMatch(/private|secret/);
    }
  });
});
