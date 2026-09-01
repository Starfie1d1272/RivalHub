import { describe, expect, it } from "vitest";
import { normalizeChsiEvidenceCode } from "./validation";

describe("normalizeChsiEvidenceCode", () => {
  it("accepts and canonicalizes current 16-character codes", () => {
    expect(normalizeChsiEvidenceCode(" abcd-1234 efgh-5678 ")).toBe("ABCD1234EFGH5678");
  });

  it("keeps historical 12-digit codes reviewable", () => {
    expect(normalizeChsiEvidenceCode("1025 0963 3215")).toBe("102509633215");
  });

  it("rejects URLs and arbitrary values", () => {
    expect(normalizeChsiEvidenceCode("https://www.chsi.com.cn/xlcx/bg.do?vcode=ABCD1234EFGH5678")).toBeNull();
    expect(normalizeChsiEvidenceCode("short-code")).toBeNull();
  });
});
