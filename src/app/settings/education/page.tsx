export const dynamic = "force-dynamic";

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { EducationVerificationPanel } from "@/components/settings/EducationVerificationPanel";
import { db } from "@/db/client";
import { educationVerifications, institutionEmailDomains, institutions, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { emailDomain } from "@/lib/education/validation";

export default async function EducationSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/education");
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) redirect("/login");
  const rows = await db.select({ id: educationVerifications.id, institution: institutions.name, code: institutions.moeInstitutionCode, academicStatus: educationVerifications.academicStatus, evidenceType: educationVerifications.evidenceType, status: educationVerifications.status, reviewNote: educationVerifications.reviewNote, submittedAt: educationVerifications.submittedAt }).from(educationVerifications).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id)).where(eq(educationVerifications.userId, user.id)).orderBy(desc(educationVerifications.submittedAt));
  const domain = emailDomain(user.email);
  const fastPath = domain ? await db.query.institutionEmailDomains.findFirst({ where: and(eq(institutionEmailDomains.domain, domain), eq(institutionEmailDomains.active, true), eq(institutionEmailDomains.autoVerify, true)) }) : null;
  return <div><h1 className="mb-2 text-3xl font-semibold">教育身份认证</h1><p className="mb-6 text-sm text-[var(--color-fg-mid)]">教育认证只用于赛事资格审核；公开页面不会展示你的学信网链接或审核备注。</p><EducationVerificationPanel email={user.email} emailVerified={Boolean(user.emailVerifiedAt)} hasInstitutionalFastPath={Boolean(fastPath)} verifications={rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }))} /></div>;
}
