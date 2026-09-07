import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { EducationVerificationPanel } from "@/components/settings/EducationVerificationPanel";
import { db } from "@/db/client";
import { educationVerifications, institutionEmailDomains, institutions, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { emailDomain } from "@/lib/education/validation";
import { listVerifiedEmailIdentities } from "@/lib/identity/linking";

export default async function EducationSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/education");
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) redirect("/login");
  const [rows, identities] = await Promise.all([
    db.select({ id: educationVerifications.id, institution: institutions.name, code: institutions.moeInstitutionCode, academicStatus: educationVerifications.academicStatus, evidenceType: educationVerifications.evidenceType, status: educationVerifications.status, reviewNote: educationVerifications.reviewNote, submittedAt: educationVerifications.submittedAt }).from(educationVerifications).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id)).where(eq(educationVerifications.userId, user.id)).orderBy(desc(educationVerifications.submittedAt)),
    listVerifiedEmailIdentities(db, user.id),
  ]);
  const identityDomains = [...new Set(identities.map((identity) => emailDomain(identity.email)).filter((domain): domain is string => Boolean(domain)))];
  const mappings = identityDomains.length === 0 ? [] : await db.select({
    domain: institutionEmailDomains.domain,
    institution: institutions.name,
  }).from(institutionEmailDomains)
    .innerJoin(institutions, eq(institutionEmailDomains.institutionId, institutions.id))
    .where(and(
      inArray(institutionEmailDomains.domain, identityDomains),
      eq(institutionEmailDomains.active, true),
      eq(institutionEmailDomains.autoVerify, true),
    ));
  const institutionByDomain = new Map(mappings.map((mapping) => [mapping.domain, mapping.institution]));
  const institutionalIdentities = identities.flatMap((identity) => {
    const domain = emailDomain(identity.email);
    const institution = domain ? institutionByDomain.get(domain) : undefined;
    return institution ? [{ identityId: identity.id, email: identity.email, institution }] : [];
  });
  return <div><h1 className="mb-2 text-3xl font-semibold">教育身份认证</h1><p className="mb-6 text-sm text-[var(--color-fg-mid)]">教育认证只用于赛事资格审核；公开页面不会展示你的学信网在线验证码或审核备注。</p><EducationVerificationPanel email={user.email} emailVerified={identities.length > 0 || Boolean(user.emailVerifiedAt)} institutionalIdentities={institutionalIdentities} verifications={rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }))} /></div>;
}
