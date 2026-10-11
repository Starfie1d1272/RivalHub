import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), revoke: vi.fn(), reliable: vi.fn(), live: vi.fn(),
  revalidate: vi.fn(), select: vi.fn(), admit: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: mocks.revalidate }));
vi.mock("@/lib/mizar/installation", () => ({ authenticateMizar: mocks.authenticate, readMizarCredentialHash: () => "hash", revokeMizarInstallation: mocks.revoke }));
vi.mock("@/lib/mizar/context", () => ({ loadMizarMatchDocument: vi.fn(), loadMizarScheduleWindow: vi.fn() }));
vi.mock("@/lib/mizar/source", async () => {
  const { z } = await import("zod");
  return { claimMizarSource: vi.fn(), releaseMizarSource: vi.fn(), sourceClaimSchema: z.unknown(), sourceReleaseSchema: z.unknown() };
});
vi.mock("@/lib/mizar/reliable", () => ({ ingestMizarReliable: mocks.reliable }));
vi.mock("@/lib/mizar/live", () => ({ ingestMizarLive: mocks.live }));
vi.mock("@/lib/mizar/live-admission", () => ({ admitLiveIngress: mocks.admit, tryAdmitLiveRequest: () => vi.fn() }));

import { POST } from "@/app/api/mizar/[operation]/route";

const matchId = "10000000-0000-4000-8000-000000000001";
function request(body = JSON.stringify({ event: { matchId } })) {
  return new Request("https://local.test/api/mizar/reliable", {
    method: "POST", headers: { "x-request-id": "req-mizar-test", "x-rivalhub-authority": "1" }, body,
  });
}
function invoke(req: Request, operation = "reliable") {
  return POST(req, { params: Promise.resolve({ operation }) });
}

// Protect the HTTP assembly: expected bad input must stay quiet, while caught
// failures must emit one event with the response ID even after domain commit.
describe("Mizar handled failure boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({ id: "installation", competitionId: "competition" });
    mocks.reliable.mockResolvedValue({ outcome: "canonicalized", duplicate: false });
    mocks.select.mockReturnValue({ from: () => ({ where: async () => [{ slug: "season" }] }) });
    mocks.admit.mockResolvedValue(vi.fn());
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["auth", "read", "validate", "domain", "revalidation"] as const)("captures one correlated safe event for an unexpected %s failure", async (phase) => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const error = new Error("private upstream https://user:password@provider.test/private?secret=value", { cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) });
    let req = request();
    if (phase === "auth") mocks.authenticate.mockRejectedValue(error);
    if (phase === "domain") mocks.reliable.mockRejectedValue(error);
    if (phase === "revalidation") mocks.revalidate.mockImplementation(() => { throw error; });
    if (phase === "validate") {
      const getHeader = req.headers.get.bind(req.headers);
      vi.spyOn(req.headers, "get").mockImplementation((name) => {
        if (name === "x-rivalhub-authority") throw error;
        return getHeader(name);
      });
    }
    if (phase === "read") req = new Request("https://local.test/api/mizar/reliable", {
      method: "POST", headers: { "x-request-id": "req-mizar-test" },
      body: new ReadableStream({ start(controller) { controller.error(error); } }), duplex: "half",
    } as RequestInit);
    const response = await invoke(req);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(write).toHaveBeenCalledOnce();
    const event = JSON.parse(String(write.mock.calls[0][0]));
    expect(event).toMatchObject({ event: "mizar.request.failure", requestId: "req-mizar-test", operation: "reliable", safeContext: { phase, httpStatus: 500 }, exception: { cause: { code: "ECONNRESET" } } });
    expect(body.requestId).toBe(event.requestId);
    expect(response.headers.get("X-Request-Id")).toBe(body.requestId);
    expect(body.error).toContain(body.requestId);
    expect(JSON.stringify(body)).not.toMatch(/private|provider|password|ECONNRESET/);
    expect(JSON.stringify(event)).not.toMatch(/user:password|secret=value/);
    if (phase === "revalidation") expect(body.error).toContain("数据可能已保存");
  });

  it("keeps auth, malformed JSON, invalid schema and oversized input as quiet 4xx", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mocks.authenticate.mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "请重新连接设备"));
    expect((await invoke(request())).status).toBe(403);
    expect((await invoke(request("{private input"))).status).toBe(400);
    expect((await invoke(request(JSON.stringify({ invalid: true })))).status).toBe(400);
    expect((await invoke(request("x".repeat(21_000)))).status).toBe(413);
    expect(mocks.reliable).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("does not duplicate LIVE capacity or handled broadcast diagnostics", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mocks.admit.mockResolvedValueOnce(null);
    expect((await invoke(request(), "live")).status).toBe(429);
    mocks.live.mockResolvedValue({ accepted: false, reason: "broadcast_unavailable" });
    const response = await invoke(request(JSON.stringify({ matchId })), "live");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false, reason: "broadcast_unavailable" });
    expect(write).not.toHaveBeenCalled();
  });
});
