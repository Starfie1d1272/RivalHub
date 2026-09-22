import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { educationVerifications } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { educationEvidenceStorage } from "@/lib/education/storage";
import { AppError, ErrorCode } from "@/lib/errors";

/** Resolve a short-lived URL for a super-admin to review a live manual evidence object. */
export async function getManualEducationEvidenceSignedUrl(input: unknown): Promise<string> {
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "教育材料标识无效。");

  await requireSuperAdmin();
  const verification = await db.query.educationVerifications.findFirst({
    where: eq(educationVerifications.id, parsed.data.id),
    columns: { evidenceType: true, evidenceObjectKey: true },
  });
  if (!verification) throw new AppError(ErrorCode.NOT_FOUND, "教育认证记录不存在。 ");
  if (verification.evidenceType !== "manual_other" || !verification.evidenceObjectKey) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "录取通知书材料当前不可查看。 ");
  }
  return educationEvidenceStorage.createSignedUrl(verification.evidenceObjectKey);
}
