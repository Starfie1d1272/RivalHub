import { describe, expect, it } from "vitest";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

describe("AppError", () => {
  it("构造并访问属性", () => {
    const e = new AppError(ErrorCode.POSITION_FULL, "AWP 位置已满员");
    expect(e.code).toBe("POSITION_FULL");
    expect(e.message).toBe("AWP 位置已满员");
    expect(e.name).toBe("AppError");
    expect(e instanceof Error).toBe(true);
  });

  it("支持 meta 元数据", () => {
    const e = new AppError(ErrorCode.NOT_FOUND, "目标不存在", {
      entityId: "abc-123",
    });
    expect(e.meta).toEqual({ entityId: "abc-123" });
  });

  it("每个 ErrorCode 都有对应的 ERROR_MESSAGES", () => {
    const codes = Object.values(ErrorCode);
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe("string");
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it("ERROR_MESSAGES key 数量与 ErrorCode 一致", () => {
    const codeCount = Object.values(ErrorCode).length;
    const msgCount = Object.keys(ERROR_MESSAGES).length;
    expect(msgCount).toBe(codeCount);
  });
});

describe("ErrorCode", () => {
  it("所有错误码唯一", () => {
    const values = Object.values(ErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("错误码命名遵循 UPPER_SNAKE_CASE", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(code).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });
});
