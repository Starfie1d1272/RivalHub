import { desc, eq } from "drizzle-orm";
import { EducationVerificationReviewQueue } from "@/components/admin/EducationVerificationReviewQueue";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { db } from "@/db/client";
import { educationVerifications, institutions, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";

export default async function EducationVerificationsAdminPage() {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const rows = await db.select({ id: educationVerifications.id, email: users.email, displayName: users.displayName, institution: institutions.name, code: institutions.moeInstitutionCode, academicStatus: educationVerifications.academicStatus, evidenceType: educationVerifications.evidenceType, evidenceCode: educationVerifications.evidenceCode, status: educationVerifications.status, submittedAt: educationVerifications.submittedAt, reviewNote: educationVerifications.reviewNote }).from(educationVerifications).innerJoin(users, eq(educationVerifications.userId, users.id)).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id)).orderBy(desc(educationVerifications.submittedAt));
  return <main className="container mx-auto max-w-3xl px-4 py-10"><h1 className="mb-2 text-3xl font-semibold">教育身份认证审核</h1><p className="mb-6 text-sm text-[var(--color-fg-mid)]">仅在学信网官方页面人工核对；申请人声明学校不一致时请驳回，不要修改其学校。</p><EducationVerificationReviewQueue rows={rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }))} /></main>;
}
