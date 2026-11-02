import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { institutions } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { decodeSeasonRules } from "@/lib/seasons/rules";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { toCSTDateTimeInput } from "@/lib/utils/date";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { loadConversionPolicyProvenance } from "@/lib/competitive/conversion-policy-admin";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";

interface SeasonSettingsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonSettingsPage({ params }: SeasonSettingsPageProps) {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const { seasonSlug } = await params;
  const seasonPromise = findAdminSeasonBySlug(seasonSlug);
  const [season, catalog, conversionPolicyProvenance] = await Promise.all([
    seasonPromise, loadCompetitivePlatformCatalog(db, { concurrent: true }),
    seasonPromise.then(season => {
      if (!season) return null;
      const config = season.teamRegistrationConfig;
      return loadConversionPolicyProvenance(db, config?.qualificationPolicy?.version === 2 ? { competitiveProfile: config.qualificationPolicy.competitiveProfile } : config);
    }),
  ]);
  if (!season) notFound();
  const rules = decodeSeasonRules(season);
  const codes = rules.roster.affiliationRules.map(rule => rule.institutionCode).filter(Boolean);
  const institutionRows = codes.length ? await db.query.institutions.findMany({ where: inArray(institutions.moeInstitutionCode, codes), columns: { id: true, name: true, moeInstitutionCode: true, province: true } }) : [];

  return (
    <div className="max-w-3xl">
      <SeasonForm
        mode="edit"
        institutionOptions={institutionRows.map(row => ({ id: row.id, name: row.name, code: row.moeInstitutionCode, province: row.province }))}
        competitivePlatforms={catalog.map((platform) => ({ key: platform.key, displayName: platform.displayName, seasons: platform.seasons.map((season) => ({ seasonKey: season.seasonKey, label: season.label, active: season.active })), ranks: platform.ranks.map((rank) => ({ rankKey: rank.rankKey, label: rank.label })) }))}
        initial={{
          id: season.id,
          name: season.name,
          slug: season.slug,
          kind: season.kind,
          template: season.competitionTemplate,
          status: season.status,
          themeColor: season.themeColor,
          logoUrl: season.logoUrl,
          registrationOpensAt: toCSTDateTimeInput(season.registrationOpensAt),
          registrationClosesAt: toCSTDateTimeInput(season.registrationClosesAt),
          rosterChangeClosesAt: toCSTDateTimeInput(season.rosterChangeClosesAt),
          registrationOpenedAt: season.registrationOpenedAt,
          conversionPolicyProvenance,
          endAt: toCSTDateTimeInput(season.endAt),
          registrationMode: season.registrationMode,
          hasCaptainVoting: season.hasCaptainVoting,
          hasDraft: season.hasDraft,
          hasCommunityAwards: season.hasCommunityAwards,
          maxTeamSize: season.maxTeamSize,
          minTeamSize: season.minTeamSize,
          starterCount: season.starterCount,
          positions: season.positions,
          stagePlan: normalizeStagePlan(season.stagePlan),
          registrationConfig: rules.registration.registrationConfig,
          teamRegistrationConfig: season.teamRegistrationConfig ?? undefined,
          affiliationRules: rules.roster.affiliationRules,
        }}
      />
    </div>
  );
}
