import { describe, expect, it } from "vitest";
import { ErrorCode } from "@/lib/errors";
import {
  EDUCATION_EVIDENCE_MAX_BYTES,
  detectEducationEvidenceImage,
  normalizeChsiEvidenceCode,
  validateEducationEvidenceFile,
} from "./validation";

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

describe("manual education evidence image contract", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

  it("accepts JPEG, PNG, and WebP only when MIME and signature agree", async () => {
    await expect(validateEducationEvidenceFile(new File([jpeg], "notice.any", { type: "image/jpeg" }))).resolves.toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
    await expect(validateEducationEvidenceFile(new File([png], "notice.jpg", { type: "image/png" }))).resolves.toMatchObject({ mimeType: "image/png", extension: "png" });
    await expect(validateEducationEvidenceFile(new File([webp], "notice.png", { type: "image/webp" }))).resolves.toMatchObject({ mimeType: "image/webp", extension: "webp" });
    expect(detectEducationEvidenceImage(png)).toEqual({ mimeType: "image/png", extension: "png" });
  });

  it("rejects empty, oversized, unsupported, and MIME/signature-mismatched files", async () => {
    await expect(validateEducationEvidenceFile(new File([], "empty.png", { type: "image/png" }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(validateEducationEvidenceFile(new File([new Uint8Array(EDUCATION_EVIDENCE_MAX_BYTES + 1)], "large.png", { type: "image/png" }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(validateEducationEvidenceFile(new File([png], "notice.pdf", { type: "application/pdf" }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(validateEducationEvidenceFile(new File([png], "notice.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(detectEducationEvidenceImage(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull();
  });
});
