import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeStagePlan, normalizeTeamRegistrationConfig } from "@/types/season";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { toCSTDateTimeInput } from "@/lib/utils/date";

interface SeasonSettingsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonSettingsPage({ params }: SeasonSettingsPageProps) {
  try {
    await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <SeasonForm
        mode="edit"
        initial={{
          id: season.id,
          name: season.name,
          slug: season.slug,
          kind: season.kind,
          status: season.status,
          themeColor: season.themeColor,
          startAt: toCSTDateTimeInput(season.startAt),
          registrationDeadline: toCSTDateTimeInput(season.registrationDeadline),
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
