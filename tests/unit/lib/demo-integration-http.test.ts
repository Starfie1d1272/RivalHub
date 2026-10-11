import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationError } from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";

afterEach(() => vi.restoreAllMocks());

describe("demo integration error boundary", () => {
  const request = new Request("https://rivalhub.example/api/demo", { headers: { origin: "null" } });

  it("keeps internal diagnostics out of the external response", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const response = integrationError(request, new AppError(ErrorCode.INTERNAL_ERROR, "StageRun secret diagnostic"));

    expect(response.status).toBe(500);
    const requestId = response.headers.get("X-Request-Id");
    const body = await response.json();
    expect(body).toEqual({ error: { code: ErrorCode.INTERNAL_ERROR, message: expect.stringContaining(`排查编号：${requestId}`) } });
    expect(JSON.stringify(body)).not.toContain("StageRun secret diagnostic");
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ event: "dak.request.failure", requestId, errorClass: "application" });
  });

  it("uses the structured product message for expected errors", async () => {
    const response = integrationError(request, AppError.withPresentation(
      ErrorCode.VALIDATION_FAILED,
      { owner: "test", key: "safe", params: {}, message: "请先完成当前步骤。" },
      { diagnostic: "internal expected-error diagnostic" },
    ));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: ErrorCode.VALIDATION_FAILED, message: "请先完成当前步骤。" },
    });
  });
});
