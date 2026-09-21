import { describe, expect, it } from "vitest";
import { integrationError } from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";

describe("demo integration error boundary", () => {
  const request = new Request("https://rivalhub.example/api/demo", { headers: { origin: "null" } });

  it("keeps internal diagnostics out of the external response", async () => {
    const response = integrationError(request, new AppError(ErrorCode.INTERNAL_ERROR, "StageRun secret diagnostic"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: ErrorCode.INTERNAL_ERROR, message: "服务器内部错误，请稍后重试" },
    });
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
