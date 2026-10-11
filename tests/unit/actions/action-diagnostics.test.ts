import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
vi.mock("@/db/client", () => ({ db: {} }));
import { actionError } from "@/lib/action-utils";

afterEach(() => vi.restoreAllMocks());

// Response/log correlation and browser privacy are boundary contracts; existing
// domain mapping tests did not check either for unexpected/internal failures.
describe("action failure diagnostics", () => {
  it.each([
    new Error("private provider details", { cause: new Error("network unavailable") }),
    new AppError(ErrorCode.INTERNAL_ERROR, "private internal details"),
  ])("returns the exact captured ID with safe handling advice", (error) => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = actionError("test.save", error, "revalidation");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(write).toHaveBeenCalledOnce();
    const event = JSON.parse(String(write.mock.calls[0][0]));
    expect(result.error.requestId).toBe(event.requestId);
    expect(result.error.message).toContain(result.error.requestId);
    expect(result.error.message).toContain("刷新确认操作结果");
    expect(event).toMatchObject({ errorCode: "INTERNAL_ERROR", safeContext: { phase: "revalidation" } });
    expect(JSON.stringify(result)).not.toMatch(/private|provider details|network unavailable/);
  });

  it("preserves expected domain presentation without capture or internal metadata", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const error = AppError.withPresentation(ErrorCode.VALIDATION_FAILED, { owner: "test", key: "invalid", params: {}, message: "请核对输入" }, { diagnostic: "private details", meta: { token: "private" } });
    expect(actionError("test.save", error)).toEqual({ success: false, error: { code: "VALIDATION_FAILED", message: "请核对输入" } });
    expect(write).not.toHaveBeenCalled();
  });
});
