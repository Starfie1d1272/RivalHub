import { describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
import { classifyError } from "@/lib/observability/errors";

describe("observability error taxonomy", () => {
  it("treats ActionResult business errors as expected outcomes", () => {
    expect(classifyError(new AppError(ErrorCode.VALIDATION_FAILED, "输入无效"))).toMatchObject({
      errorClass: "expected",
      errorCode: ErrorCode.VALIDATION_FAILED,
      retryable: false,
    });
  });

  it("keeps internal AppError failures in the application class", () => {
    expect(classifyError(new AppError(ErrorCode.INTERNAL_ERROR, "内部失败"))).toMatchObject({
      errorClass: "application",
      errorCode: ErrorCode.INTERNAL_ERROR,
    });
  });

  it("reuses SQLSTATE classification for retryable database errors", () => {
    expect(classifyError({ cause: { code: "40001", constraint: "safe_constraint", detail: "private" } })).toMatchObject({
      errorClass: "database",
      errorCode: "40001",
      retryable: true,
    });
  });

  it("allows a provider or security owner to make an explicit classification", () => {
    expect(classifyError(new Error("dependency timeout"), { errorClass: "dependency", retryable: true })).toMatchObject({
      errorClass: "dependency",
      retryable: true,
    });
  });
});
