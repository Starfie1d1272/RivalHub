import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeStagePlan, normalizeTeamRegistrationConfig } from "@/types/season";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { toCSTDateTimeInput } from "@/lib/utils/date";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";

interface SeasonSettingsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonSettingsPage({ params }: SeasonSettingsPageProps) {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/login");
  }

  const { seasonSlug } = await params;
  const [season, catalog] = await Promise.all([db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  }), loadCompetitivePlatformCatalog(db)]);
  if (!season) notFound();

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <SeasonForm
        mode="edit"
        competitivePlatforms={catalog.map((platform) => ({ key: platform.key, displayName: platform.displayName, seasons: platform.seasons.map((season) => ({ seasonKey: season.seasonKey, label: season.label, active: season.active })), ranks: platform.ranks.map((rank) => ({ rankKey: rank.rankKey, label: rank.label })) }))}
        initial={{
          id: season.id,
          name: season.name,
          slug: season.slug,
          kind: season.kind,
          template: season.competitionTemplate,
          status: season.status,
          themeColor: season.themeColor,
          registrationOpensAt: toCSTDateTimeInput(season.registrationOpensAt),
          registrationClosesAt: toCSTDateTimeInput(season.registrationClosesAt),
          rosterChangeClosesAt: toCSTDateTimeInput(season.rosterChangeClosesAt),
          registrationOpenedAt: season.registrationOpenedAt,
          endAt: toCSTDateTimeInput(season.endAt),
          registrationMode: season.registrationMode,
          hasCaptainVoting: season.hasCaptainVoting,
          hasDraft: season.hasDraft,
          maxTeamSize: season.maxTeamSize,
          minTeamSize: season.minTeamSize,
          starterCount: season.starterCount,
          positions: season.positions,
          stagePlan: normalizeStagePlan(season.stagePlan),
          registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
          teamRegistrationConfig: normalizeTeamRegistrationConfig(season.teamRegistrationConfig),
          affiliationRules: normalizeAffiliationRules(season.affiliationRules),
        }}
      />
    </div>
  );
}
