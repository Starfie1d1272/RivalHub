import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), submit: vi.fn(), revalidate: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/demo-integration/pairing", () => ({ authenticateDakRequest: mocks.authenticate }));
vi.mock("@/lib/demo-integration/submit", () => ({ submitRivalHubEvidence: mocks.submit }));
vi.mock("@/lib/revalidation", () => ({ revalidatePublicStatsTag: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { POST } from "@/app/api/integrations/dak/evidence/route";

const request = () => new Request("https://example.test/api/integrations/dak/evidence?token_hash=private", {
  method: "POST", body: "{}",
  headers: { "x-request-id": "req-dak-recovery", origin: "null", authorization: "Bearer private" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ pairing: { id: "private-pairing" } });
  mocks.submit.mockResolvedValue({ status: "synced", importId: "private-import" });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

function events() {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => JSON.parse(String(text)));
}

// The existing DB suites own transaction/idempotency. These tests own the HTTP
// boundary when commit succeeds but delivery fails, and safe diagnostic capture.
describe("DAK handled failure recovery", () => {
  it("keeps one redacted cause chain and one correlated event for a domain failure", async () => {
    mocks.submit.mockRejectedValue(new Error("provider request failed", {
      cause: Object.assign(new Error("reset https://private.test/path?token=private token=private"), { code: "ECONNRESET" }),
    }));
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBe("req-dak-recovery");
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.message).toContain("req-dak-recovery");
    expect(JSON.stringify(body)).not.toContain("ECONNRESET");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ event: "dak.request.failure", requestId: "req-dak-recovery", route: "/api/integrations/dak/evidence", safeContext: { phase: "domain", httpStatus: 500 }, exception: { cause: { code: "ECONNRESET" } } });
    expect(JSON.stringify(events())).not.toContain("token=private");
    expect(JSON.stringify(events())).not.toContain("private-pairing");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("directs post-commit failure to saved results without inviting retransmission", async () => {
    mocks.revalidate.mockImplementation(() => { throw new Error("cache failed"); });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error.message).toBe("已收到提交，请先查看保存结果并核对导入状态，不要重新上传；如无法查看，请联系管理员。排查编号：req-dak-recovery");
    expect(body.error.message).not.toContain("重试");
    expect(response.headers.get("X-Request-Id")).toBe("req-dak-recovery");
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      requestId: "req-dak-recovery", safeContext: { phase: "revalidation" }, exception: { message: "cache failed" },
    });
  });

  it.each([ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN, ErrorCode.VALIDATION_FAILED])("keeps %s quiet and preserves the expected response", async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, "请先核对授权。"));
    const response = await POST(request());
    expect(response.status).toBe(code === ErrorCode.UNAUTHORIZED ? 401 : code === ErrorCode.FORBIDDEN ? 403 : 422);
    await expect(response.json()).resolves.toEqual({ error: { code, message: "请先核对授权。" } });
    expect(events()).toEqual([]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("uses SQLSTATE metadata without SQL or provider payload in log or response", async () => {
    mocks.submit.mockRejectedValue(new Error("Failed query: insert into private", { cause: { code: "23505", constraint: "demo_lineage_unique", detail: "private@email.test", query: "raw SQL", parameters: ["private"] } }));
    const response = await POST(request());
    expect(events()[0]).toMatchObject({ errorClass: "database", errorCode: "23505", exception: { name: "PostgreSQLError", code: "23505", constraint: "demo_lineage_unique" } });
    expect(JSON.stringify(events())).not.toContain("insert into");
    expect(JSON.stringify(events())).not.toContain("private@email");
    expect(JSON.stringify(await response.json())).not.toContain("23505");
  });

  it("preserves success and CORS without emitting errors", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "synced", importId: "private-import" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(events()).toEqual([]);
  });
});
