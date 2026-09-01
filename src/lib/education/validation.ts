import { z } from "zod";

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
  institutionId: z.string().uuid(),
  academicStatus: z.enum(["enrolled", "graduated"]),
  evidenceCode: z.string().trim().min(1).max(64),
});

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@") || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}
