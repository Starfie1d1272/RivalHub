import { z } from "zod";

const CHSI_HOSTS = new Set(["www.chsi.com.cn", "chsi.com.cn"]);

/** Accept only a normalized HTTPS URL on the official CHSI host. */
export function normalizeChsiEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !CHSI_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const educationSubmissionSchema = z.object({
  institutionId: z.string().uuid(),
  academicStatus: z.enum(["enrolled", "graduated"]),
  evidenceType: z.enum(["chsi_enrollment_report", "chsi_education_report"]),
  evidenceUrl: z.string().trim().min(1).max(2048),
});

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@") || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}
