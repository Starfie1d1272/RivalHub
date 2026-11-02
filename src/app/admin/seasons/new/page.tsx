import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { db } from "@/db/client";
import { institutions } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { PageLayout } from "@/components/rivalhub";

export default async function NewSeasonPage() {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const major = createCompetitionTemplate("major");
  const codes = major.affiliationRules.map(rule => rule.institutionCode).filter(Boolean);
  const [catalog, institutionRows] = await Promise.all([
    loadCompetitivePlatformCatalog(db, { concurrent: true }),
    codes.length ? db.query.institutions.findMany({ where: inArray(institutions.moeInstitutionCode, codes), columns: { id: true, name: true, moeInstitutionCode: true, province: true } }) : [],
  ]);

  return (
    <PageLayout variant="narrow">
      <SeasonForm
        mode="create"
        institutionOptions={institutionRows.map(row => ({ id: row.id, name: row.name, code: row.moeInstitutionCode, province: row.province }))}
        competitivePlatforms={catalog.map((platform) => ({ key: platform.key, displayName: platform.displayName, seasons: platform.seasons.map((season) => ({ seasonKey: season.seasonKey, label: season.label, active: season.active })), ranks: platform.ranks.map((rank) => ({ rankKey: rank.rankKey, label: rank.label })) }))}
        initial={{
          name: "",
          slug: "",
          kind: "Major",
          template: "major",
          status: "draft",
          themeColor: null,
          registrationOpensAt: null,
          registrationClosesAt: null,
          rosterChangeClosesAt: null,
          endAt: null,
          ...major,
        }}
      />
    </PageLayout>
  );
}
