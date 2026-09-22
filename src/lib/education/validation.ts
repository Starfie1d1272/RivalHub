import { z } from "zod";
import { AppError, ErrorCode } from "@/lib/errors";

export const EDUCATION_EVIDENCE_MAX_BYTES = 5_242_880;
export const EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const EDUCATION_EVIDENCE_SIGNED_URL_TTL_SECONDS = 60;

export type EducationEvidenceMimeType = (typeof EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES)[number];

export interface ValidatedEducationEvidenceFile {
  file: File;
  mimeType: EducationEvidenceMimeType;
  extension: "jpg" | "png" | "webp";
}

const CURRENT_CHSI_CODE = /^[A-Z0-9]{16}$/;
// CHSI switched newly requested reports from the historical 12-digit code to
// 16 characters in 2019. Keep valid legacy reports reviewable without treating
// arbitrary strings or report URLs as evidence.
const LEGACY_CHSI_CODE = /^\d{12}$/;

/** Canonicalize display separators, then accept only CHSI's current or legacy code shapes. */
export function normalizeChsiEvidenceCode(value: string): string | null {
  const normalized = value.trim().replace(/[\s-]+/g, "").toUpperCase();
  return CURRENT_CHSI_CODE.test(normalized) || LEGACY_CHSI_CODE.test(normalized) ? normalized : null;
}

export const educationSubmissionSchema = z.object({
  institutionId: z.guid(),
  academicStatus: z.enum(["enrolled", "graduated"]),
  evidenceCode: z.string().trim().min(1).max(64),
});

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@") || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Validate the deliberately narrow manual-evidence image contract at the
 * server boundary. The browser may use the same constants for affordances,
 * but MIME and signature are always checked again here.
 */
export async function validateEducationEvidenceFile(value: unknown): Promise<ValidatedEducationEvidenceFile> {
  if (!(value instanceof File) || value.size <= 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请上传一张非空的录取通知书图片。 ");
  }
  if (value.size > EDUCATION_EVIDENCE_MAX_BYTES) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "录取通知书图片不能超过 5 MiB。 ");
  }
  if (!(EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(value.type)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请上传 JPG、PNG 或 WebP 格式的录取通知书图片。 ");
  }

  const bytes = new Uint8Array(await value.arrayBuffer());
  const detected = detectEducationEvidenceImage(bytes);
  if (!detected || detected.mimeType !== value.type) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "图片格式与文件内容不一致，请重新选择 JPG、PNG 或 WebP 图片。 ");
  }

  return { file: value, ...detected };
}

export function detectEducationEvidenceImage(bytes: Uint8Array): Pick<ValidatedEducationEvidenceFile, "mimeType" | "extension"> | null {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: "image/png", extension: "png" };
  if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}
